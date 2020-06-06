module.exports = (function (Utils) {
	"use strict";

	const request = require("request");
	const EventEmitter = require("events");
	const SocketIO = require("socket.io-client");
	const Logger = require("./cytube-logger.js");

	const NO_COOLDOWN_TRIGGERED = Symbol.for("NO_COOLDOWN");
	const defaultConfig = {
		secure : true,
		host : "cytu.be",
		port : "443",
		chan : "test",
		pass : null,
		user : "Test-" + Math.random().toString(16).slice(-8),
		auth : null,
		agent : "CyTube Client 0.4",
		debug : (process.env.NODE_ENV === "production" ? false : true),
		socketURL : null,
		cooldown: {},
		socket: null
	};
	const config = {
		host: "cytu.be",
		secure: true,
		user: "Supibot",
		auth: process.env.CYTUBE_BOT_PASSWORD,
		chan: "ForsenOffline",
	};

	const handlers = [ "disconnect",
		/*
			These are from CyTube /src/user.js
		*/
		"announcement",
		"clearVoteskipVote",
		"kick",
		"login",
		"setAFK",

		/*
			Current list as of 2017-06-04
			The following command was used to get this list from CyTube /src/channel/
			$> ( spot emit && spot broadcastAll ) \
				| awk {"print $2"} | sed "s/"/\n"/g" \
				| grep """ | grep -Pi "[a-z]" | sort -u
		*/
		"addFilterSuccess",
		"addUser",
		"banlist",
		"banlistRemove",
		"cancelNeedPassword",
		"changeMedia",
		"channelCSSJS",
		"channelNotRegistered",
		"channelOpts",
		"channelRankFail",
		"channelRanks",
		"chatFilters",
		"chatMsg",
		"clearchat",
		"clearFlag",
		"closePoll",
		"cooldown",
		"costanza",
		"delete",
		"deleteChatFilter",
		"drinkCount",
		"emoteList",
		"empty",
		"errorMsg",
		"listPlaylists",
		"loadFail",
		"mediaUpdate",
		"moveVideo",
		"needPassword",
		"newPoll",
		"noflood",
		"playlist",
		"pm",
		"queue",
		"queueFail",
		"queueWarn",
		"rank",
		"readChanLog",
		"removeEmote",
		"renameEmote",
		"searchResults",
		"setCurrent",
		"setFlag",
		"setLeader",
		"setMotd",
		"setPermissions",
		"setPlaylistLocked",
		"setPlaylistMeta",
		"setTemp",
		"setUserMeta",
		"setUserProfile",
		"setUserRank",
		"spamFiltered",
		"updateChatFilter",
		"updateEmote",
		"updatePoll",
		"usercount",
		"userLeave",
		"userlist",
		"validationError",
		"validationPassed",
		"voteskip",
		"warnLargeChandump",
	];

	class CytubeClient extends EventEmitter {
		constructor (parentClient, commands) {
			super();
			Object.assign(this, defaultConfig, config);

			this.once("ready", () => {
				this.connect();
				this.emit("clientinit");
			})
			.once("connected", () => {
				this.start();
				this.emit("clientready");
			})
			.once("started", () => {
				this.assignLateHandlers();
			});

			this.on("error", (err) => {
				this.console.error(err);
			});

			this.connected = false;
			this.handlersAssigned = false;

			this.commands = commands;
			this.ircClient = parentClient;

			this.userList = [];
			this.playlistData = [];
			this.isPlaying = false;
			this.lastSong = "<no previous song>";

			this.assignCustomHandlers();

			this.console = {
				log: (...args) => console.log("[CYTUBE]", ...args),
				error: (...args) => console.log("[CYTUBE ERROR]", ...args),
				debug: (...args) => (this.debug) && console.log("[CYTUBE DEBUG]", ...args)
			};

			this.getSocketURL();
		}

		assignCustomHandlers () {
			// this.on("rank", (rank) => { this.handleRank(rank) }); // This is self rank
			// this.on("usercount", (count) => { this.handleUserCount(count) });

			// this.on("userlist", (list) => { this.handleUserList(list) });
			// this.on("addUser", (user) => { this.handleUserAdd(user) });
			// this.on("setAFK", (user) => { this.handleUserAFK(user) });
			// this.on("setLeader", (user) => { this.handleUserLeader(user) });
			// this.on("setUserMeta", (user) => { this.handleUserMeta(user) });
			// this.on("setUserProfile", (user) => { this.handleUserProfile(user) });
			// this.on("setUserRank", (user) => { this.handleUserRank(user) });
			// this.on("userLeave", (user) => { this.handleUserRemove(user) });

			// this.on("emoteList", (list) => { this.handleEmoteList(list) });
			// this.on("updateEmote", (emote) => { this.handleEmoteUpdate(emote) });
			// this.on("removeEmote", (emote) => { this.handleEmoteRemove(emote) });
			// this.on("renameEmote", (emote) => { this.handleEmoteRename(emote) });

			// this.on("playlist", (list) => { this.handlePlaylist(list) });
			// this.on("setPlaylistLocked", (data) => { this.handlePlaylistLocked(data) });
			// this.on("setPlaylistMeta", (data) => { this.handlePlaylistMeta(data) });
			// this.on("listPlaylists", (data) => { this.handleListPlaylists(data) });
			// this.on("delete", (data) => { this.handleVideoDelete(data) });
			// this.on("changeMedia", (data) => { this.handleVideoChange(data) });
			// this.on("mediaUpdate", (data) => { this.handleVideoUpdate(data) });
			// this.on("moveVideo", (data) => { this.handleVideoMove(data) });
			// this.on("queue", (data) => { this.handleVideoQueue(data) });
			// this.on("queueFail", (data) => { this.handleVideoQueueFail(data) });
			// this.on("queueWarn", (data) => { this.handleVideoQueueWarn(data) });
			// this.on("setCurrent", (data) => { this.handleVideoCurrent(data) });
			// this.on("setTemp", (data) => { this.handleVideoTemp(data) });

			// this.on("banlist", (list) => { this.handleBanList(list) });
			// this.on("banlistRemove", (ban) => { this.handleBanRemove(ban) });
			// this.on("setPermissions", (chanperms) => { this.handleChanPerms(chanperms) });
			// this.on("channelOpts", (chanopts) => { this.handleChanOpts(chanopts) });
			// this.on("clearchat", (who) => { this.handleClearChat(who) });
			// this.on("drinkCount", (count) => { this.handleDrinkCount(count) });
			// this.on("setMotd", (banner) => { this.handleBanner(banner) });
		}

		assignLateHandlers () {
			this.on("disconnect", () => { 
				this.connected = false;
				this.ircClient && this.ircClient.send("#supibot", "DISCONNECT | CYTUBE");
				setTimeout(() => {
					this.ircClient.CytubeClient = new CytubeClient(this.ircClient, this.commands);
					this.destroy();
				}, 5000);
			});

			this.on("chatMsg", (data) => {
				const msg = data.msg.replace(/&quot;/g, "\"").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/<(?:.|\n)*?>/gm, "");
				const usr = data.username.toLowerCase();
				const shadowbanned = !!data.meta.shadow;
				const bot = this;
				const replyObject = {
					reply: function (msg) {
						bot.sendMessage(msg);
					},
					_reply: function (...args) { replyObject.reply(...args); }
				};

				this.ircClient.checkAFK(usr.toLowerCase(), null, replyObject);

				if (usr !== this.user.toLowerCase()) {
					Logger.logMessage(usr, msg);
				}

				if (!shadowbanned && msg[0] === "$") {
					const arg = msg.trim().replace(/\s+/, " ").split(" ");
					const cmd = arg.shift().slice(1);
					this.handleCommand(cmd, usr, arg);
				}
			});

			this.on("pm", (data) => {
				// { username: 'Supinic',
				// msg: 'test',
				// meta: {},
				// time: 1533645127713,
				// to: 'Supibot' }
				const msg = data.msg.replace(/&quot;/g, "\"").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/<(?:.|\n)*?>/gm, "");
				const usr = data.username.toLowerCase();

				this.console.log("Whisper", "[" + new Date(data.time).simpleDateTime() + "] " + usr + ": " + msg);

				if (msg[0] === "$") {
					const arg = msg.split(" ");
					const cmd = arg.shift().slice(1);
					this.handleCommand(cmd, usr, arg, true);
				}
				else {
					this.pm({ 
						msg: "I can't reply to custom whispers. Yet. MrDestructoid",
						meta: {},
						to: data.username 
					});
				}
			});

			this.on("queue", (data) => { 
				// { item: 
				//    { media: 
				//       { id: 'Q3L0gArhmaE',
				//         title: 'SOMEONE STOP THIS MADMAN! (Flex Tape)',
				//         seconds: 646,
				//         duration: '10:46',
				//         type: 'yt',
				//         meta: {} },
				//      uid: 1237,
				//      temp: true,
				//      queueby: 'Supinic' },
				//   after: 1236 }
				const who = data.item.queueby;
				const media = data.item.media;

				if (who !== this.user.toLowerCase()) {
					Logger.logRequest(who, media.id, media.type, media.seconds);
				}

				if (media.seconds === 0 && media.type === "yt" && who !== "Supinic" && who !== "agenttud") { // @todo mods only
					this.sendMessage(who + ", requesting a youtube stream (" + media.title + ") used to be not allowed pepeL but it's fine now");
					// this.sendMessage(who + ", requesting a youtube stream (" + media.title + ") is not allowed pepeL");
					// this.deleteVideo(data.item.uid);
				}

				this.pm({
					msg: "Video " + media.id + " added by " + who,
					to: "Supinic"
				});

				this.playlistData.push({
					media: media,
					user: who,
					uid: data.item.uid,
					after: data.after
				});
			});

			this.on("addUser", (data) => {
				this.userList.push(data);
				this.pm({msg: data.name + " just joined pepeL", to: "Supinic"});
			});

			this.on("userlist", (data = []) => {
				this.pm({msg: "userlist event, data length: " + data.length, to: "Supinic"});
				for (const user of data) {
					this.userList.push(user);
				}
			});

			this.on("userLeave", (data) => {
				const index = this.userList.findIndex(i => i.name === data.name);
				if (index !== -1) {
					const leavingUser = this.userList.splice(index, 1)[0];
					this.pm({msg: leavingUser.name + " just left pepeL", to: "Supinic"});
				}
			});

			this.on("playlist", (data = []) => { 
				for (const video of data) {
					this.playlistData.push(video);
				}
				this.pm({msg: "Playlist initialized with " + data.length + " videos", to: "Supinic"});
			});

			this.on("delete", (data) => {
				const index = this.playlistData.findIndex(i => i.uid === data.uid);
				if (index !== -1) {
					this.playlistData.splice(index, 1)[0];
				}
			});

			this.on("changeMedia", (data) => {
				this.pm({msg: "Change media. Old playlist length: " + this.playlistData.length + ", new: " + this.playlistData.length - 1, to: "Supinic"});
				this.playlistData.shift();
			});

			// this.on("voteskip", (evt, a, b, c) => {
			// 	this.console.log("Voteskip", evt, a, b, c);
			// });

			// this.on("mediaUpdate", (data) => {
				//{ currentTime: 15.006999999999998, paused: false }
			// });
		}

		handleCommand (cmd, usr, arg, whisperCommand) {
			// Doesn't reply to itself
			if (usr === this.user.toLowerCase()) {
				return;
			}

			const now = Date.now();
			const command = (cmd === "debug" && usr === "supinic")
				? this.commands.find(i => (i.name === "__debug__"))
				: this.commands.find(i => (i.name === cmd) || (i.aliases && i.aliases.has(cmd)));
		
			// Set implicit user level if none is found
			this.ircClient.CFG.USER_LEVELS[usr] = this.ircClient.CFG.USER_LEVELS[usr] || 1;
			this.cooldown[usr] = this.cooldown[usr] || {};
			
			// Command does not exist - skip
			if (!command) {
				return;
			}

			// Banned user - skip
			if (this.ircClient.CFG.USER_LEVELS[usr] <= -1e6) {
				return;
			}

			const cytube = this;
			const evt = {
				cmd: cmd,
				user: { getNick: () => usr },
				channel: { getName: () => "cytube_forsenoffline" },
				reply: (...args) => { 
					let msg = args.join(" ");
					if (usr.toLowerCase() !== "supinic") {
						cytube.ircClient.send("#supibot", "CMD | Cytube | " + usr + " | " + this.ircClient.CFG.COMMAND_PREFIX + cmd + " " + arg.join(" "));
					}

					if (Utils.globalCheck(msg, this.ircClient.CFG.GLOBAL_BANPHRASES)) {
						msg = "I ain't saying that cmonBruh";
					}

					if (!whisperCommand) {
						cytube.sendMessage(msg);
					}
					else {
						cytube.pm({ 
							msg: msg,
							meta: {},
							to: usr
						});
					}
				},
				_reply: (...args) => evt.reply(...args)
			};
			
			if (this.ircClient.CFG.USER_LEVELS[usr] < command.level) {
				if (!whisperCommand) {
						evt.reply("You don't have the sufficient level to execute that command.");
					}
					else {
						this.pm({ 
							msg: "You don't have the sufficient level to execute that command.",
							meta: {},
							to: usr
						});
					}
				return;
			}

			// Cooldown not expired - skip
			this.cooldown[usr][command.name] = this.cooldown[usr][command.name] || 1;
			if (now < this.cooldown[usr][command.name] && usr !== "supinic") {
				const remaining = Utils.round(Math.abs(now - this.cooldown[usr][command.name]) / 1000, 3);
				this.pm({ 
					msg: "You still have " + remaining + "s remaining on your cooldown for " + this.ircClient.CFG.COMMAND_PREFIX + command.name,
					meta: {},
					to: usr 
				});
				return;
			}

			console.log(`CMD REQUEST (Cytube) [${new Date().simpleDateTime()}] <${usr}>: ${this.ircClient.CFG.COMMAND_PREFIX}${command.name} ${(arg && arg.join(" ")) || ""}`);
			
			const result = command.exec(usr, arg, evt);
			if (result instanceof Promise)  {
				result.then(data => {
					if (data === NO_COOLDOWN_TRIGGERED) {
						this.cooldown[usr][command.name] = now;
					}
				}).catch(err => {
					this.console.log(err);
					evt.reply("An error occured monkaSR");
				});
			}
			else {
				if (result === NO_COOLDOWN_TRIGGERED) {
					this.cooldown[usr][command.name] = now;
				}
			}

			this.cooldown[usr][command.name] = now + (command.cooldown * 1000);
		}

		get configURL() {
			return `${this.secure ? "https" : "http"}://${this.host}:${this.port}/socketconfig/${this.chan}.json`;
		}

		getSocketURL () {
			this.console.log("Getting socket config");
			this.console.debug("From URL", this.configURL);
			request(
				{
					url: this.configURL,
					headers: {
						"User-Agent": this.agent
					},
					timeout: 20 * 1000
				},
				(error, response, body) => {
					if (error) {
						this.console.error(error);
						this.emit("error", new Error("Socket lookup failure"));
						return;
					}

					if (response.statusCode !== 200) {
						this.console.error("Something went wrong. Status " + response.statusCode + ".", "\n", body);
						this.emit("error", new Error("Socket lookup failure"));
					}

					let data = null;
					try {
						data = JSON.parse(body);
					}
					catch (e) {
						this.console.error(e);
						console.error(body);
					}

					let servers = [...data.servers];
					while (servers.length) {
						const server = servers.pop();
						if (server.secure === this.secure && typeof server.ipv6 === "undefined") {
							this.socketURL = server.url;
						}
					}
					
					if (!this.socketURL) {
						this.console.error("No suitable sockets available.");
						this.emit("error", new Error("No socket available"));
						return;
					}
					
					this.console.log("Socket server url retrieved:", this.socketURL);
					this.emit("ready");
				}
			);
		}

		connect () {
			if (this.socket) {
				this.console.log("Closing already existing connection...");
				this.socket.close();
			}

			this.console.log("Connecting to socket server");
			this.emit("connecting");

			this.socket = SocketIO(this.socketURL)
				.on("error", err => this.emit("error", new Error(err)))
				.once("connect", () => {
					if (!this.handlersAssigned) {
						this.assignHandlers();
						this.handlersAssigned = true;
					}
					this.connected = true;
					this.emit("connected");
				});
				
			return this;
		}

		start () {
			this.console.log("Connecting to channel.");
			this.socket.emit("joinChannel", { name: this.chan });
			this.emit("starting");

			this.socket.once("needPassword", () => {
				if (typeof this.pass !== "string") {
					this.console.error("Login failure: Channel requires password.");
					this.emit("error", new Error("Channel requires password"));
					return;
				}
				this.console.log("Sending channel password.");
				this.socket.emit("channelPassword", this.pass);
			});

			this.killswitch = setTimeout(() => { 
				this.console.error("Failure to establish connection within 60 seconds.");
				this.emit("error", new Error("Channel connection failure"));
			}, 60 * 1000);

			this.socket.once("login", (data) => {
				if (typeof data === "undefined") {
					this.emit("error", new Error("Malformed login frame recieved"));
					return;
				}

				if (!data.success) {
					this.console.error("Login failure");
					this.console.error(JSON.stringify(data));
					this.emit("error", new Error("Channel login failure"));
				}
				else {
					this.console.log("Channel connection established.");
					this.emit("started");
					clearTimeout(this.killswitch);
				}
			});

			this.socket.once("rank", () => {
				this.socket.emit("login", {
					name: this.user,
					pw: this.auth
				});
			});

			return this;
		}

		assignHandlers () {
			this.console.log("Assigning event handlers.");
			
			handlers.forEach(frame => {
				this.socket.on(frame, (...args) => {
					this.emit(frame, ...args);
				});
			});
		}

		sendMessage (msg) {
			let arr = msg.replace(/(\r?\n)/g, " ").replace(/\s{2,}/g, " ").match(/.{1,200}/g) || ["<empty message>"];
			let index = 0;

			if (arr.length > 3) {
				arr = arr.slice(0, 3);
				arr[2] = arr[2].slice(0, 196) +  "...";
			}

			for (const partialMsg of arr) {
				setTimeout(() => this.chat({
					msg: partialMsg,
					meta: {}
				}), index * 10);

				index++;
			}
		}

		destroy () {
			this.ircClient = null;
			this.playlistData = null;
			this.userList = null;
			this.commands = null;
		}
	}

	Object.assign(CytubeClient.prototype, {
		// Messages
		chat: function (chatMsg) {
			this.socket.emit("chatMsg", chatMsg);
		},
		pm: function (privMsg) {
			this.socket.emit("pm", privMsg);
		},

		// Polls
		createPoll: function (poll) {
			this.socket.emit("newPoll", poll);
		},
		closePoll: function () {
			this.socket.emit("closePoll");
		},

		// Channel Control
		sendOptions: function (opts) {
			this.socket.emit("setOptions", opts);
		},
		sendPermissions: function (perms) {
			this.socket.emit("setPermissions", perms);
		},
		sendBanner: function (banner) {
			this.socket.emit("setMotd", banner);
		},

		// Bans
		bans: function () {
			this.socket.emit("requestBanlist");
		},
		unban: function (ban) {
			this.socket.emit("unban", ban);
		},

		// Media Control
		leader: function (leader) {
			this.socket.emit("assignLeader", leader);
		},
		deleteVideo: function (uid) {
			this.socket.emit("delete", uid);
		},
		move: function (pos) {
			this.socket.emit("moveMedia", pos);
		},
		jump: function (uid) {
			this.socket.emit("jumpTo", uid);
		},
		shuffle: function () {
			this.socket.emit("shufflePlaylist");
		},
		playlist: function () {
			this.socket.emit("requestPlaylist");
		}
	});

	return CytubeClient;
});