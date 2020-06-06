module.exports = (function () {
	"use strict";

	class ChannelMap {
		constructor (discordToIRC) {
			this.d2i = new Map();
			this.i2d = new Map();

			Object.keys(discordToIRC).forEach(key => {
				this.d2i.set(key, discordToIRC[key]);
			});

			Object.keys(discordToIRC).forEach(key => {
				this.i2d.set(discordToIRC[key], key);
			});
		}

		getIRC (discord) {
			return this.d2i.get(discord);
		}

		getDiscord (IRC) {
			return this.i2d.get(IRC);
		}

		destroy () {
			this.d2i.clear();
			this.i2d.clear();

			this.d2i = null;
			this.i2d = null;
		}
	}

	const fixDiscordMessage = (msg) => {
		let string = msg.cleanContent.replace(/\n/g, " ") + " " + msg.attachments.map(i => i.proxyURL);
		return string;
	};

	const fixIRCMessage = (msg, emojis) => {
		return msg.split(" ").map(word => {
			const emote = emojis.find("name", word);
			return (emote === null)
				? word
				: emote.toString();
		}).join(" ");
	};

	const Logger = require("./discord-logger.js");

	return class DiscordBot {
		constructor (ParentClient, Utils, key, channels, commands) {
			this.name = "supibot";
			this.commands = commands;
			this.utils = Utils;
			this.discordClient = new (require("discord.js")).Client();
			this.ircClient = ParentClient;
			this.map = new ChannelMap(channels || {});

			this.discordClient.on("ready", () => {
				console.log("Discord bot - ready!");
			});

			this.discordClient.on("message", async (msg) => {
				if (msg.content.startsWith("ping")) {
					msg.channel.send("pong!");
					return;
				}

				if (!this.ircClient.CFG.DISCORD_LINK_ENABLED) {
					return;
				}

				const now = Date.now();
				const discordChannel = msg.channel.id;
				const chanString = String(discordChannel);
				const channelIRC = this.map.getIRC(discordChannel);
				const user = msg.author.username.toLowerCase();

				// Skip unlinked discord channels
				if (!channelIRC) {
					return;
				}
				// Skip commands issued by the bot itself
				else if (user === this.name) {
					return;
				}

				const bot = this;
				const commandChar = this.ircClient.CFG.COMMAND_PREFIX;
				const commandCheck = msg.cleanContent.split(" ");
				const cmdName = (commandCheck[0] || "").substring(1);
				const replyObject = {
					reply: function (discordMsg) {
						bot.rawDiscordSend(discordMsg, discordChannel);
						bot.protectedIRCSend(channelIRC, "🇩 " + discordMsg);
					},
					_reply: function (...args) { replyObject.reply(...args); }
				};

				this.ircClient.checkAFK(user, null, replyObject);

				Logger.log(msg, discordChannel)
					.catch(e => console.log("Logging error", e));

				if (this.ircClient.CFG.USER_LEVELS[user] <= -1e6) {
					return;
				}

				const cmd =
					msg.content.startsWith(this.ircClient.CFG.COMMAND_PREFIX)
					&& this.commands.find(i =>
						i.name === cmdName || (i.aliases || []).indexOf(cmdName) !== -1
					);

				this.ircClient.USER_COOLDOWNS[user] = this.ircClient.USER_COOLDOWNS[user] || {};
				this.ircClient.DISCORD_LINK_COOLDOWNS[chanString] = this.ircClient.DISCORD_LINK_COOLDOWNS[chanString] || {};
				this.ircClient.DISCORD_LINK_COOLDOWNS[chanString][user] = this.ircClient.DISCORD_LINK_COOLDOWNS[chanString][user] || 0;

				if (this.ircClient.DISCORD_LINK_COOLDOWNS[chanString][user] > now) {
					return;
				}

				if (cmd) {
					this.ircClient.USER_COOLDOWNS[user][cmd.name] = this.ircClient.USER_COOLDOWNS[user][cmd.name] || 0;
					if (this.ircClient.USER_COOLDOWNS[user][cmd.name] > now) {
						return;
					}

					if (typeof cmd.level !== "undefined" && (this.ircClient.CFG.USER_LEVELS[user] || 0) < cmd.level) {
						this.rawDiscordSend("You don't have sufficient level to execute that command!", discordChannel);
						this.protectedIRCSend(
							channelIRC,
							"🇩 " + user + " tried to use " + commandChar + cmdName + ": Failed - no permission",
						);
						this.ircClient.DISCORD_LINK_COOLDOWNS[chanString][user] = now + this.ircClient.CFG.DISCORD_LINK_COOLDOWN;
						return;
					}
					else if (cmd.whitelist && !cmd.whitelist.some(i => i === "discord_" + discordChannel)) {
						this.rawDiscordSend("This command cannot be executed in this channel.", discordChannel);
						this.protectedIRCSend(
							channelIRC,
							"🇩 " + user + " tried to use " + commandChar + cmdName + ": Failed - no channel permission",
						);
						return;
					}

					const args = commandCheck.splice(1);
					const evt = {
						cmd: cmdName,
						user: { getNick: () => user },
						channel: { getName: () => "discord_" + discordChannel },
						reply: (...replyArgs) => {
							const result = replyArgs.join(" ");
							this.rawDiscordSend(result, discordChannel);		

							this.protectedIRCSend(
								channelIRC,
								"🇩 " + user + ": " + commandChar + cmdName + " " + args.join(" ")
							);

							setTimeout(() => this.protectedIRCSend(
								channelIRC,
								"🇩 " + result
							), 500);

							this.protectedIRCSend(
								"#supibot",
								"CMD | " + user + " | " + msg.cleanContent + " | DISCORD"
							);
						},
						rawReply: (...replyArgs) => {
							let result = replyArgs.join(" ");
							setTimeout(() => this.protectedIRCSend(
								channelIRC,
								result
							), 500);
						}
					};
					evt._reply = evt.reply;
					console.log("CMD REQUEST (Discord) [" + new Date().simpleDateTime() + "] <" + user + ">: " + msg);

					try {
						cmd.exec(user, args.slice(0), evt);
					}
					catch (e) {
						console.log("CMD FAIL (Discord) [" + new Date().simpleDateTime() + "]", msg, e);
						this.ircClient.restartFn("DISCORD CMD");
					}

					// @todo - add special cooldown cases handling (no cooldown triggered etc)
					if (cmd.cooldown) {
						this.ircClient.USER_COOLDOWNS[user][cmd.name] = now + (cmd.cooldown * 1000);
					}
				}
				else if (msg.author.username !== this.name && typeof channelIRC !== "undefined") {
					try {
						let fixedMsg = "🇩 " + msg.author.username + ": " + fixDiscordMessage(msg, this.ircClient.CFG.DISCORD_ALLOWED_EMOTES);
						this.protectedIRCSend(channelIRC, this.utils.safeWrap(fixedMsg, 450));
					}
					catch (e) {
						console.log("DISCORD FAIL [" + new Date().simpleDateTime() + "]", e);
						this.ircClient.restartFn("DISCORD MSG");
					}
				}

				this.ircClient.DISCORD_LINK_COOLDOWNS[chanString][user] = now + this.ircClient.CFG.DISCORD_LINK_COOLDOWN;
			});

			this.discordClient.on("error", (err) => {
				console.log("Discord error!", err.toString());
			});

			this.discordClient.login(key);
		}

		rawDiscordSend (msg, chan) {
			if (!this.discordClient) {
				console.log("There is no discord client?");
			}
			else {
				const banned = this.utils.globalCheck(msg, this.ircClient.CFG.GLOBAL_BANPHRASES);
				if (banned) {
					for (const phrase of this.ircClient.CFG.GLOBAL_BANPHRASES) {
						msg = msg.replace(new RegExp(phrase, "gi"), "[REDACTED]");
					}
				}

				this.discordClient.channels.get(chan).send(this.utils.safeWrap(msg, 1000));
			}
		}

		protectedIRCSend (channel, msg = "") {
			msg = msg.replace(this.utils.zeroWidthRegex, "");
			const banned = this.utils.globalCheck(msg, this.ircClient.CFG.GLOBAL_BANPHRASES);
			if (banned) {
				for (const phrase of this.ircClient.CFG.GLOBAL_BANPHRASES) {
					msg = msg.replace(new RegExp(phrase, "gi"), "[REDACTED]");
				}
			}

			this.ircClient.send(channel, this.utils.safeWrap(msg, 450).replace(/<a?:(.*?):(\d*)>/g, (total, emote) => emote));
		}

		send (user, msg, channelIRC/*, tags*/) {
			if (!this.ircClient.CFG.DISCORD_LINK_ENABLED) {
				return;
			}

			const now = Date.now();
			const discordChannel = this.map.getDiscord(channelIRC);

			this.ircClient.DISCORD_LINK_COOLDOWNS[channelIRC] = this.ircClient.DISCORD_LINK_COOLDOWNS[channelIRC] || {};
			this.ircClient.DISCORD_LINK_COOLDOWNS[channelIRC][user] = this.ircClient.DISCORD_LINK_COOLDOWNS[channelIRC][user] || 0;

			if (discordChannel && now > this.ircClient.DISCORD_LINK_COOLDOWNS[channelIRC][user]) {
				this.rawDiscordSend("🇹 **" + user + "**: " + fixIRCMessage(msg, this.discordClient.emojis), discordChannel);		
				this.ircClient.DISCORD_LINK_COOLDOWNS[channelIRC][user] = now + this.ircClient.CFG.DISCORD_LINK_COOLDOWN;
			}
		}

		destroy () {
			this.discordClient.destroy();
			this.map.destroy();

			this.utils = null;
			this.ircClient = null;
			this.discordClient = null;
			this.map = null;
		}
	};
})();
