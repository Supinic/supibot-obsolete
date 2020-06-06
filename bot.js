(function () {
	"use strict";

	const fs = require("fs");
	const request = require("request");
	require("/code/keys/load-keys.js")();

	const Utils = require("/code/global-modules/utils.js");
	let CytubeConstructor = require("./my-modules/cytube.js")(Utils);
	const DiscordConstructor = require("./my-modules/discord.js");
	let CONFIG = JSON.parse(fs.readFileSync("config.json"));

	const LINK_REGEX = /(https?:\/\/(?:www\.|(?!www))[ @#a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9]\.[^\s]{2,})/gi;
	const WHISPERS_ONLY = Symbol.for("WHISPERS_ONLY");
	const WHISPERS_AND_CHATS = Symbol.for("WHISPERS_AND_CHATS");
	const NO_COOLDOWN_TRIGGERED = Symbol.for("NO_COOLDOWN");

	const IRC = require("coffea");
	let client = IRC({
		host: CONFIG.CHAT_SERVER_URL,
		port: CONFIG.CHAT_SERVER_PORT,
		ssl: false,
		nick: process.env.TWITCH_USERNAME,
		username: process.env.TWITCH_USERNAME,
		pass: process.env.TWITCH_OAUTH,
		throttling: CONFIG.CLIENT_DEFAULT_THROTTLE,
		prefix: CONFIG.COMMAND_PREFIX
	});

	client.CFG = CONFIG;
	CONFIG = null;

	client.DISCORD_LINK_COOLDOWNS = {};
	client.USER_BAN_TIMERS = {};
	client.USER_AFK_DATA = {};
	client.USER_COOLDOWNS = {};
	client.GLOBAL_COOLDOWNS = {};
	client.BAN_EVASION_FLAGS = {};
	
	client.TIMEOUT_POOL = {};
	client.PERMABAN_POOL = {};

	client.TIMEOUT_TIMER = {};
	client.PERMABAN_TIMER = {};

	client.HARD_RESET_TIMESTAMP = Number(process.argv[2]) || Date.now();
	client.SOFT_RESET_TIMESTAMP = Date.now();
	client.HYDRATION_MESSAGE = {};
	client.latestTriviaAnswer = null;

	let COMMANDS = require("./my-modules/commands.js")(Utils, client, fs);
	let SUPINIC_CHANNEL = require("./my-modules/supinic.js")(client);
	const DEBUG = COMMANDS.find(i => i.name === "__debug__");
	const RESTART = COMMANDS.find(i => i.name === "restart");
	const AFK = COMMANDS.find(i => i.name === "afk");

	const checkAFK = async (user, chan, evt) => {
		if (!client.USER_AFK_DATA[user]) {
			return;
		}

		const data = client.USER_AFK_DATA[user];
		if (chan && client.CFG.PAJLADIFIED_CHANNELS.has(chan)) {
			evt.reply = pajladify(user, chan, 150, {name: "afk"}).bind(evt);
		}

		(!data.silent) && setTimeout(() => {
			// console.log(user + " is no longer AFK: " + data.text + " (" + Utils.ago(data.date) + ")");
			const ago = (new Date(data.date).valueOf() === 0) ? "unknown time" : Utils.ago(data.date);
			evt.reply(user + " is no longer AFK: " + data.text + " (" + ago + ")");
		}, 1000);

		COMMANDS.unsetAFK(data.id).then(() => { client.USER_AFK_DATA[user] = null; });
	};
	const pajladify = (user, chan, msgLimit, command = {}) => (async function (msg) {
		client.BAN_EVASION_FLAGS[chan] = !client.BAN_EVASION_FLAGS[chan];
		msg += " " + (client.BAN_EVASION_FLAGS[chan] ? client.CFG.BAN_EVASION_CHARACTER : "");

		if (client.CFG.NO_LINK_CHANNELS.has(chan)) {
			msg = msg.replace(LINK_REGEX, "[LINK]"); // replace all links with some text
		}

		const now = new Date();
		if (chan === "#forsen") {
			msg = msg
				.replace(/[ČĘÊÏÑŇŚ]/ig, char => char.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) // replaces all "dangerous" local characters with safe ones
				.replace(/poggers/ig, "[POOGERS]") // replace all poggers with something more palatable
				.replace(/(PogU)/g, "Pog U") // replace all PogU with Pog U - for better readability
				.replace(/twitch\.tv/gi, "[LINK]");

			if (now.getDate() === 8 && now.getMonth() === 1 && now.getFullYear() === 2019) {
				msg = msg.toLowerCase();
			}
		}
		else if (chan === "#nymn") {
			msg = msg
				.replace(/https?:\/\/t\.co/g, "twitter") // replace twitter short links
				.replace(/\u05E4/g, "9");  // replace "dangerous" hebrew characters
		}

		let finalMessage = "";
		try {			
			const userBanned = await Utils.pajladaCheck(user, chan, client.CFG);
			let fixedUser = (!userBanned) ? user : "[illegal name]";

			let ping = "";
			if (client.CFG.PING_CHANNELS.has(chan) && !client.CFG.PING_EXCLUDED_COMMANDS.has(command.name)) {
				ping = fixedUser + ", ";
			}

			msg = Utils.safeWrap(ping + msg, msgLimit);
			const msgBanned = await Utils.pajladaCheck(msg, chan, client.CFG);

			(msgBanned) && console.log("COMMAND REQUEST FAILED - BANNED PHRASE", msg, msgBanned);
		
			finalMessage = (!msgBanned) ? msg : msgBanned.reply;
		}
		catch (e) {
			console.log("COMMAND REQUEST FAILED - NO API AVAILABLE");
			console.log(e);
			finalMessage = "Cannot comply, pajbot API failed to reply monkaS";
		}

		if (now.getDate() === 8 && now.getMonth() === 1) {
			if (chan === "#nymn") finalMessage = finalMessage.toUpperCase();
			if (chan === "#forsen") finalMessage = finalMessage.toLowerCase();
		}

		this._reply("send", finalMessage);
	});

	client.checkAFK = checkAFK;
	client.restartFn = (msg) => setTimeout(() => RESTART(null, null, null, msg), 5000);
	client.reloadModule = (type, evt) => {
		switch (type) {
			case "commands": 
				COMMANDS.destroy();
				COMMANDS = null;
				delete require.cache[require.resolve("./my-modules/commands.js")];
				COMMANDS = require("./my-modules/commands.js")(Utils, client, fs);
				client.CytubeClient.commands = COMMANDS;
				client.DiscordClient.commands = COMMANDS;
				break;

			case "cytube": 
				client.CytubeClient.destroy();
				client.CytubeClient = null;
				delete require.cache[require.resolve("./my-modules/cytube.js")];
				CytubeConstructor = require("./my-modules/cytube.js")(Utils);
				client.CytubeClient = new CytubeConstructor(client, COMMANDS);
				break;

			default: return false;
		}

		evt.reply("Done.");
		return true;
	};

	client.DiscordClient = new DiscordConstructor(client, Utils, process.env.DISCORD_BOT_TOKEN, client.CFG.DISCORD_LINK, COMMANDS);
	client.CytubeClient = new CytubeConstructor(client, COMMANDS);

	client.on("motd", () => {
		client.join(client.CFG.JOIN_CHANNELS);
		client.capReq(":twitch.tv/tags twitch.tv/commands twitch.tv/membership");
		console.log("Bot: Ready!");
		client.send("#supibot", "@Supinic I'm back MrDestructoid");
	});

	client.on("message", (evt) => {
		const user = evt.user.getNick().toLowerCase();
		const chan = evt.channel.getName();
		const msg = evt.message;
		const now = Date.now();

		if (chan === "#supinic") {
			SUPINIC_CHANNEL.message(
				user,
				msg,
				client.CFG.USER_LEVELS[user] <= -1e6,
				client.CFG.USER_LEVELS[user] < 1e6 && (client.GLOBAL_COOLDOWNS[chan] && now <= client.GLOBAL_COOLDOWNS[chan])
			);
		}

		// Skip banned users
		if (client.CFG.USER_LEVELS[user] <= -1e6) {
			return;
		}

		// Declare AFK people as non AFK - silently, if necessary
		checkAFK(user, chan, evt);

		// If it's a stealth channel, skip everything
		if (client.CFG.STEALTH_CHANNELS.indexOf(chan) !== -1) {
			return;
		}

		// Mirror messages to discord, if it's a linked channel
		if (chan === client.CFG.CHAN.CEREBOT && client.CFG.DISCORD_LINK_ENABLED) {
			client.DiscordClient && client.DiscordClient.send(user, msg, chan, evt.tags);
		}

		// Return if global cooldown did not pass. Does not apply to supermods
		if (client.CFG.USER_LEVELS[user] < 1e6 && (client.GLOBAL_COOLDOWNS[chan] && now <= client.GLOBAL_COOLDOWNS[chan])) {
			return;
		}

		if (msg.indexOf("$debug") === 0 && client.CFG.USER_LEVELS[user] >= DEBUG.level) {
			DEBUG.exec(user, msg.split("$debug")[1].split(" "), evt);
		}
		else if (msg === "bot" || msg.indexOf("!afk") === 0) {
			let silent = false;

			if (msg === "bot") {
				evt.reply("smol bot made by @supinic supiniL my commands start with $ - try $help for a list of commands");
			}
			else if (msg.indexOf("!afk") === 0) {
				silent = true;
				AFK.exec(user, msg.split(" ").splice(1), evt, true);
			}

			if (!silent) {
				client.GLOBAL_COOLDOWNS[chan] = client.GLOBAL_COOLDOWNS[chan] || 0;
				client.GLOBAL_COOLDOWNS[chan] = now + (client.CFG.CHANNEL_GLOBAL_COOLDOWNS[chan] || client.CFG.DEFAULT_GLOBAL_COOLDOWN);
			}
		}
		else if (chan === "#forsen" && (user === "forsenai" || user === "snusbot")) {
			if (
				(user === "forsenai" && msg.indexOf("forsenThink") !== -1) ||
				(user === "snusbot" && msg.indexOf("question/hint/clue") !== -1)
			) {
				let query = msg
					.replace(" forsenThink", "")
					.replace(/.*clue is(.*)" OMGScoots(.*)/, "$1")
					.replace(/ /g, "+");
				let url = "http://www.j-archive.com/search.php?submit=Search&search=" + query;

				request(url, (err, data, body) => {
					let parsedData = body.match(/class="search_correct_response">(.*?)<\/span>/);
					let answer = (parsedData && Utils.removeHTML(parsedData[1])) || null;

					if (answer) {
						client.latestTriviaAnswer = answer;
						client.AUTO_TRIVIA && evt.reply(answer);
						// console.log("[" + new Date().simpleDateTime() + "] Answer: ", answer);
					}
					else {
						client.latestTriviaAnswer = "eShrug idk kev";
						// console.log("idk");
					}
				});
			}
		}
		else if (chan === "#forsen" && user === "gazatu2" && msg.has("question:")) {
			const question = (msg.match(/question: (.*)/) || [])[1];

			COMMANDS.autoGazatu(question)
			.then(answer => {
				if (client.AUTO_GAZ && answer) {
					evt.reply(answer);
				}
				// console.log(`GAZATU TRIVIA [${answer || "<no answer found>"}] <- ${question}`);
			})
			.catch(err => console.log("[GAZATU TRIVIA ERROR] ", err));
		}
	});

	client.on("command", (evt) => {
		if (!evt.channel) {
			console.log("An event with no channel?", evt);
			return;
		}

		const args = (evt.args || []).map(i => i.replace(new RegExp(client.CFG.BAN_EVASION_CHARACTER, "g"), "").trim());
		const cmd = evt.cmd.toLowerCase(); // @todo remove this, it is just temporary
		const chan = evt.channel.getName().toLowerCase();
		const user = evt.user.getNick().toLowerCase();
		const now = Date.now();

		client.CFG.USER_LEVELS[user] = client.CFG.USER_LEVELS[user] || 1;

		const command = COMMANDS.find(i =>
			cmd === i.name.toLowerCase() || (Array.isArray(i.aliases) && i.aliases.some(j => cmd === j.toLowerCase()))
		);

		if (!command) {
			return;
		}

		// Skip own commands, if that would ever happen for some reason.
		if (user === "supibot") return;

		console.log(`CMD REQUEST (${chan}) [${new Date().simpleDateTime()}] <${user}>: ${client.CFG.COMMAND_PREFIX}${cmd} ${(args && args.join(" ")) || ""}`);

		// Skip banned users
		if (client.CFG.USER_LEVELS[user] <= -1e6) {
			console.log("CMD REQUEST FAILED - BANNED");
			return;
		}

		// Declare AFK people as non AFK - silently, if necessary
		// checkAFK(user, chan, evt);

		// If it's a stealth channel, skip everything
		if (client.CFG.STEALTH_CHANNELS.indexOf(chan) !== -1) {
			console.log("CMD REQUEST FAILED - STEALTH CHANNEL");
			return;
		}

		// Skip if global cooldown hasn't passed yet. Doesn't apply to supermods.
		// Also doesn't apply to read-only commands, those never reply - no global cooldown is needed.
		if (!command.readOnly && client.CFG.USER_LEVELS[user] < 1e6 && now <= client.GLOBAL_COOLDOWNS[chan]) {
			console.log("CMD REQUEST FAILED - GLOBAL COOLDOWN", (client.GLOBAL_COOLDOWNS[chan] - now));
			return;
		}

		client.USER_COOLDOWNS[user] = client.USER_COOLDOWNS[user] || {};

		// Skip execution if the user cooldown isn't expired
		if (client.CFG.USER_LEVELS[user] < 1e6 && now <= client.USER_COOLDOWNS[user][command.name]) {
			const time = (client.USER_COOLDOWNS[user][command.name] - now) / 1000;
			client.send("#supibot",
				".w " + user + " " +
				"Your cooldown for " + client.CFG.COMMAND_PREFIX + cmd + " " +
				"has not expired yet: " + time + " seconds remaining."
			);
			console.log("CMD REQUEST FAILED - USER COOLDOWN", (client.USER_COOLDOWNS[user][command.name] - now));
			return;
		}

		// Set the global cooldown in all cases
		client.GLOBAL_COOLDOWNS[chan] = now + (client.CFG.CHANNEL_GLOBAL_COOLDOWNS[chan] || client.CFG.DEFAULT_GLOBAL_COOLDOWN);

		const msgLimit = client.CFG.CHANNEL_MSG_LIMIT[chan] || client.CFG.DEFAULT_MSG_LIMIT || 450;

		// If it's a protected channel, pajbot-check it. This is done by overwriting the reply function with a call to the snusbot API, and checking its result
		if (client.CFG.PAJLADIFIED_CHANNELS.indexOf(chan) !== -1) {
			evt.reply = pajladify(user, chan, msgLimit, command).bind(evt);
		}
		// If it isn't, modify the reply function so that we always send the ban-evasion character and do some basic banphrase checking.
		else {
			evt.reply = (function (msg) {
				const isDiscord = (Object.values(client.CFG.DISCORD_LINK).indexOf(chan) !== -1);
				let ping = "";
				if (client.CFG.PING_CHANNELS.has(chan) && !client.CFG.PING_EXCLUDED_COMMANDS.has(command.name)) {
					ping = user + ", ";
				}

				client.BAN_EVASION_FLAGS[chan] = !client.BAN_EVASION_FLAGS[chan];
				msg = ping
					+ msg + " "
					+ (client.BAN_EVASION_FLAGS[chan] ? client.CFG.BAN_EVASION_CHARACTER : "");
				
				if (Utils.globalCheck(msg, client.CFG.GLOBAL_BANPHRASES)) {
					for (const phrase of client.CFG.GLOBAL_BANPHRASES) {
						msg = msg.replace(new RegExp(phrase, "gi"), "[REDACTED]");
					}
				}

				this._reply("send", Utils.safeWrap(msg, msgLimit));
				(isDiscord) && setTimeout(() => 
					client.DiscordClient.send(user, " used " + client.CFG.COMMAND_PREFIX + cmd + ": " + msg, chan, evt.tags),
					500
				);
			}).bind(evt);
		}

		if (args.join(" ").length > 400) {
			evt.reply(":z message too long.");
			console.log("CMD REQUEST FAILED - MESSAGE TOO LONG", args.join(" ").length);
		}
		else if (command.blacklist && command.blacklist.some(i => i === chan)) {
			evt.reply("This command cannot be executed in this channel.");
			console.log("CMD REQUEST FAILED - CHANNEL BLACKLISTED");
		}
		else if (command.whitelist && !command.whitelist.some(i => i === chan)) {
			evt.reply("This command cannot be executed in this channel.");
			console.log("CMD REQUEST FAILED - CHANNEL NOT WHITELISTED");
		}
		else if (typeof command.level !== "undefined" && (client.CFG.USER_LEVELS[user] || 0) < command.level) {
			evt.reply("You don't have the sufficient level to execute that command.");
			console.log("CMD REQUEST FAILED - NO USER LEVEL");
		}
		else if (command.whispers === WHISPERS_ONLY) {
			evt.reply("This command is available via whispers only");
			console.log("CMD REQUEST FAILED - COMMAND IS WHISPER ONLY");
		}
		else {
			let result = null;
			if (user !== "supinic") {
				client.send("#supibot", `CMD | ${chan} | ${user} | ${client.CFG.COMMAND_PREFIX}${cmd} ${args.join(" ")}`);
			}

			try {
				result = command.exec(user, args, evt);
			}
			catch (e) {
				evt.reply("monkaS command execution failed!");
				console.log("CMD REQUEST FAILED - INTERNAL ERROR");
				console.log(e.toString());
				return;
			}

			// Apply a cooldown, if the command has one. Skip if the command requested for no specific cooldown to be triggered - usually happens in failed invocations
			if (result !== NO_COOLDOWN_TRIGGERED && command.cooldown) {
				if (typeof client.CFG.CHANNEL_USER_COOLDOWNS[chan] === "undefined") {
					client.USER_COOLDOWNS[user][command.name] = now + (command.cooldown * 1000);
				}
				else {
					// Apply the larger cooldown: channel-specific or command-specific.
					const cd = Math.max((command.cooldown * 1000), client.CFG.CHANNEL_USER_COOLDOWNS[chan]);
					client.USER_COOLDOWNS[user][command.name] = now + cd;
				}
			}
		}
	});

	client.on("data", (evt) => {
		const skipRegex = /ERR_UNKNOWNCOMMAND|USERSTATE|PRIVMSG|JOIN|PART|MODE|PING|RPL*|CAP/gim;

		if (skipRegex.test(evt.command)) {
			return;
		}

		if (evt.command === "CLEARCHAT") {
			const now = Date.now();
			const targetUser = evt.trailing;
			const targetChannel = evt.params;
			const logsURL = (usr, chan) => `https://api.gempir.com/channel/${chan.replace(/#/, "")}/user/${usr}`;

			// Time out
			if (evt.string.indexOf("ban-duration") !== -1) {
				client.USER_BAN_TIMERS[targetUser] = client.USER_BAN_TIMERS[targetUser] || 0;
				const time = evt.string.match(/ban-duration=(\d+)/);
				const length = Number(time[1]);
				const filterLength = client.CFG.CHANNEL_BAN_THRESHOLD[targetChannel] || client.CFG.DEFAULT_BAN_THRESHOLD;

				if (
					(!client.CFG.USERS_ALWAYS_SHOW_BAN.has(targetUser)) // if the target is NOT a user who should always be shown,
					&& (length < filterLength)// and if the timeout length is lower than the channel threshold, or the default threshold if the channel has none,
				) {
					return; // then do not log the timeout.
				}

				client.TIMEOUT_TIMER[targetChannel] = client.TIMEOUT_TIMER[targetChannel] || 1;

				// Only log the message if it has not been repeated again in a while
				if ((now - client.USER_BAN_TIMERS[targetUser]) > 5000) {
					let logsLink = "";
					if ((targetChannel === "#forsen" || targetChannel === "#nymn") && length >= 7200) {
						logsLink = " | " + logsURL(targetUser, targetChannel);
					}

					// No pooling necessary if the time passed between two timeouts is long enough
					if (now - client.TIMEOUT_TIMER[targetChannel] > client.CFG.TIMEOUT_POOLING_TIMEOUT) {
						client.TIMEOUT_TIMER[targetChannel] = now;
						client.send("#supibot", "BAN | " + targetChannel + " | " + targetUser + " | " + length + logsLink);
					}
					// If not, and the timeout pool object doesn't exist, create it
					else if (!client.TIMEOUT_POOL[targetChannel]) {
						client.TIMEOUT_POOL[targetChannel] = {
							timeout: setTimeout(() => client.TIMEOUT_POOL[targetChannel].fn(), client.CFG.TIMEOUT_POOLING_TIMEOUT),
							users: [targetUser],
							lengths: [length],
							fn: () => {
								const obj = client.TIMEOUT_POOL[targetChannel];
								const joined = obj.users.map((i, ind) => i + " " + obj.lengths[ind]).join(", ");
								const msg = (joined.length <= 450)
									? joined
									: (obj.users.length + "x for a total of " + obj.lengths.reduce((acc, cur) => acc += cur) + " sec");

								client.send("#supibot", (obj.users.length > 1 ? "GROUP " : "") + "BAN | " + targetChannel + " | " + msg);
								client.TIMEOUT_POOL[targetChannel] = null;
							}
						};
					}
					// If not, and the timeout pool object exists, append the user and timeout to it and reset the timeout and the timer
					else {
						const pool = client.TIMEOUT_POOL[targetChannel];
						clearTimeout(pool.timeout);
						pool.users.push(targetUser);
						pool.lengths.push(length);
						pool.timeout = setTimeout(() => pool.fn(), client.CFG.TIMEOUT_POOLING_TIMEOUT);
					}

					client.USER_BAN_TIMERS[targetUser] = now;
					client.TIMEOUT_TIMER[targetChannel] = now;
				}

				// If the timeout is very long (>2 hours), it is rarely automated. In that case, add a file log
				if (length >= 7200) {
					console.log(`LONG TIMEOUT [${new Date().simpleDateTime()}] (${targetChannel}) ${targetUser} (length: ${length})`);
				}
			}
			// Permaban
			else if (targetUser) {
				client.PERMABAN_TIMER[targetChannel] = client.PERMABAN_TIMER[targetChannel] || 1;

				if (now - client.PERMABAN_TIMER[targetChannel] > client.CFG.TIMEOUT_POOLING_TIMEOUT) {
						client.PERMABAN_TIMER[targetChannel] = now;
						client.send("#supibot", "PERMABAN | " + targetChannel + " | " + targetUser);
					}
					// If not, and the timeout pool object doesn't exist, create it
					else if (!client.PERMABAN_POOL[targetChannel]) {
						client.PERMABAN_POOL[targetChannel] = {
							timeout: setTimeout(() => client.PERMABAN_POOL[targetChannel].fn(), client.CFG.TIMEOUT_POOLING_TIMEOUT),
							users: [targetUser],
							fn: () => {
								const obj = client.PERMABAN_POOL[targetChannel];
								const joined = obj.users.join(", ");
								const msg = (joined.length <= 450) ? joined : (obj.users.length + "x");

								client.send("#supibot", (obj.users.length > 1 ? "GROUP " : "") + "PERMABAN | " + targetChannel + " | " + msg);
								client.PERMABAN_POOL[targetChannel] = null;
							}
						};
					}
					else {
						const pool = client.PERMABAN_POOL[targetChannel];
						clearTimeout(pool.timeout);
						pool.users.push(targetUser);
						pool.timeout = setTimeout(() => pool.fn(), client.CFG.TIMEOUT_POOLING_TIMEOUT);
					}

					client.USER_BAN_TIMERS[targetUser] = now;
					client.PERMABAN_TIMER[targetChannel] = now;

				// Always log to file
				console.log(`PERMABAN [${new Date().simpleDateTime()}] (${targetChannel}) ${targetUser}`);
			}
			// Clear chat
			else {
				// client.send("#supibot", "CLR | " + evt.params);
			}
		}
		else if (evt.command === "RECONNECT") {
			RESTART.exec(null, null, evt, true);
		}
		else if (evt.params === "#supinic") {
			SUPINIC_CHANNEL.data(evt.command, evt.string, evt);
		}
		else if (evt.command === "HOSTTARGET") {
			const params = evt.trailing.split(" ");

			if (params[0] === "-") {
				return;
			}

			client.send("#supibot", "HOST | FROM " + evt.params.substr(1) + " | TO " + params[0] + " | VIEWERS " + params[1]);
		}
		else if (evt.command === "USERNOTICE") {
			const type = evt.string.replace(/.*;msg-id=(.*?);.*/, "$1");
			const user = evt.string.replace(/.*;display-name=(.*?);.*/, "$1");
			const channel = evt.string.replace(/.* (#.*?)/, "$1");
			const now = "[" + new Date().fullDateTime() + "]";
			const PLANS = {
				1000: "$5",
				2000: "$10",
				3000: "$25",
				Prime: "Prime"
			};

			if (client.CFG.STEALTH_CHANNELS.has(channel.replace(/ :.*/, ""))) {
				return;
			}

			switch (type) {
				case "sub": 
				case "resub": {
					const months = evt.string.replace(/.*;msg-param-months=(.*?);.*/, "$1");
					const plan = evt.string.replace(/.*;msg-param-sub-plan=(.*?);.*/, "$1");

					client.send("#supibot", type.toUpperCase() + " | " + channel + " | " + months + "m | " + " TIER " + PLANS[plan] + " | " + user);
					console.log(type.toUpperCase(), now, "(" + channel + ")", months + "m | " + " TIER " + PLANS[plan] + " | " + user);
					break;
				}

				case "giftpaidupgrade": {
					const gifter = evt.string.replace(/.*msg-param-sender-name=(.*?);.*/, "$1");
					client.send("#supibot", "SUBTEMBER | " + channel + " | " + user + " CONTINUES GIFT FROM " + gifter);
					console.log("SUBTEMBER", now, "(" + channel + ")", user + " CONTINUES GIFT FROM " + gifter);
					break;
				}

				case "subgift": {
					const recipient = evt.string.replace(/.*msg-param-recipient-display-name=(.*?);.*/, "$1");
					const months = evt.string.replace(/.*;msg-param-months=(.*?);.*/, "$1");
					const plan = evt.string.replace(/.*;msg-param-sub-plan=(.*?);.*/, "$1");

					console.log("GIFTSUB", now, "(" + channel + ")", "FROM " + user + " TO " + recipient + " | " + months + "m | " + " TIER " + PLANS[plan]);
					break;
				}

				case "submysterygift": {
					const count = evt.string.replace(/.*msg-param-mass-gift-count=(.*?);.*/, "$1");
					client.send("#supibot", "MASS GIFTSUB | FROM " + user + " | " + count + "x | " + channel);
					console.log("MASS GIFTSUB ", now, "(" + channel + ")", "FROM " + user + " | " + count + "x");
					break;
				}

				default: console.log("UNRECOGNIZED SUB EVENT", now, evt.command, "|", evt.trailing, "|", evt.string);
			}
		} 
		else {
			const now = "[" + new Date().fullDateTime() + "]";
			console.log(evt.command, now, evt.trailing, "|", evt.string);
		}

		if (evt.command !== "WHISPER") {
			return;
		}

		let msg = evt.trailing;
		let user = evt.prefix.split("!")[0];

		console.log("WHISPER", user, msg, msg.indexOf("$"));

		if (msg.indexOf("$") === 0) {
			const cmdString = msg.split(" ")[0].split("$")[1];
			const args = msg.split(" ").slice(1);
			const now = Date.now();

			// Skip banned users
			if (client.CFG.USER_LEVELS[user] <= -1e6) {
				return;
			}

			client.USER_COOLDOWNS[user] = client.USER_COOLDOWNS[user] || {};

			// Change the reply function so that instead of replying to the event (in whispers, we don't have any channel available),
			// the bot whispers the user via #supinic channel
			evt.reply = (function (msg) {
				client.send(client.CFG.CHAN.SUPINIC, ".w " +  user + " " + msg);
			}).bind(evt);

			// Return if global cooldown did not pass yet. Does not apply to supermods
			if (client.CFG.USER_LEVELS[user] < 1e6 && now <= client.USER_COOLDOWNS[user].whispers) {
				return;
			}

			const command = COMMANDS.find(i => i.name === cmdString && i.whisper === WHISPERS_ONLY || i.whisper === WHISPERS_AND_CHATS);

			if (command) {
				client.USER_COOLDOWNS[user].whispers = now + client.CFG.DEFAULT_GLOBAL_COOLDOWN;

				if (typeof command.level !== "undefined" && (client.CFG.USER_LEVELS[user] || 0) < command.level) {
					evt.reply("You need a level of " + command.level + " to execute that command.");
					return;
				}
				else {
					try {
						// Always notify @Supinic that someone whispered the bot
						client.send("#supibot", ".w supinic " + user + ": " + msg);
						command.exec(user, args, evt);
					}
					catch (e) {
						evt.reply("monkaS command execution failed!");
						console.log("WHISPER ERROR CAUGHT!\n", e);
					}
				}
				return;
			}
		}

		// Log all non-command whispers. Also, notify @Supinic about them
		if (user !== "supinic") {
			client.send("#supibot", ".w supinic " + user + " said: " + msg);
		}
	});

	client.on("error", (err, evt) => {
		console.log("IRC error!", err, evt);
		client.restartFn("CONNECTION LOST");
	});

	// client.AKYLUS_RAFFLE = setInterval(() => client.send("#akylus_", "!raffle 10k 600"), 27e5);

	process.on("beforeExit", () => {
		client.CytubeClient.destroy();
		client.DiscordClient.destroy();
		fs.writeFileSync("config.json", JSON.stringify(client.CONFIG, null, 2));
	});

	client.APPLE_RAFFLE_ENABLED = false;
	client.APPLE_RAFFLE_INTERVAL = setInterval(() => {
		(client.APPLE_RAFFLE_ENABLED) && client.send("#appledcs", "!multiraffle 10000 600");
	}, 3600000);
})();