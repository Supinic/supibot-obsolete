module.exports = (function (Utils, MasterClient) {
	"use strict";

	const fs = require("fs");
	const Maria = require("mariadb");
	const fixHTML = new (require("html-entities").AllHtmlEntities)().decode;
	const Spawn = require("child_process").spawn;
	const GoogleTranslate = require("google-translate-api");
	const ParserRSS = new (require("rss-parser"))();

	const Pool = Maria.createPool({
		user: process.env.MARIA_USER,
		// password: process.env.MARIA_PASSWORD,
		host: process.env.MARIA_HOST,
		connectionLimit: 10
	});

	const Recordset = require("/code/global-modules/recordset.js")(Pool);
	const Row = require("/code/global-modules/row.js")(Pool);

	const TranslateLanguages = require("./languages.js");
	const ExtraNews = require("./command-modules/extra-news.js")(ParserRSS, Utils);
	const Twitter = require("./twitter.js")(Utils, require("twitter"));
	const MathJS = require("./math.js");
	const LocalRequest = require("./local-request.js");
	const VLC = require("./vlc-control.js")(Utils);
	const Hogger = require("./hogger.js");

	const DARKSKY_WEATHER_REGEX = /(hour|day|week)(\+?(\d+))?$/;
	const COMMAND_PREFIX = MasterClient.CFG.COMMAND_PREFIX;
	const CHAN = MasterClient.CFG.CHAN;
	const NO_COOLDOWN_TRIGGERED = Symbol.for("NO_COOLDOWN");

	const QUERY = {
		RL: {
			MAX_ID: (db, table) => `SELECT FLOOR(RAND() * (SELECT MAX(ID) FROM ${db}.${table})) AS Number`
		}
	};

	(async () => {
		// connector.query("SET NAMES 'utf8mb4_general_ci' COLLATION 'utf8mb4_general_ci'");	
		const data = await (new Recordset()
			.db("chat_data")
			.select("User_Alias.Name")
			.select("AFK.ID", "Date", "Text", "Silent")
			.from("AFK")
			.join("User_Alias", "chat_data")
			.where("AFK.Silent = %b", false)
			.where("AFK.Active = %b", true)
			.fetch()
		);

		for (const record of data) {
			MasterClient.USER_AFK_DATA[record.Name] = {
				id: record.ID,
				text: record.Text || "(no message)",
				date: record.Date,
				silent: (Number(record.Silent) === 1)
			};
		}
	})();

	const EZ_QUERY = async (evt, query) => {
		const check = query.toUpperCase();
		if (check.has("DROP") || check.has("DELETE") || check.has("UPDATE") || check.has("INSERT")) {
			evt.reply("Only SELECT is allowed...");
			return;
		}

		const connector = await Pool.getConnection();
		try {
			const data = await connector.query(query);
			evt.reply(data[0]);
		}
		catch (e) {
			evt.reply(e);
		}
		finally {
			await connector.end();
		}
	};
	const firstOrLastLine = async (channel, userID, type) => {
		let rs = null;
		const direction = (type === "FIRST") ? "ASC" : "DESC";

		if (channel === "cerebot"  || channel === "discord_150782269382983689") {
			rs = (await new Recordset()
				.raw(`SELECT * FROM (
						(SELECT Text, Posted FROM chat_line._trump_nonsub_refuge WHERE User_Alias = ${userID} ORDER BY ID ${direction} LIMIT 1)
						UNION ALL
						(SELECT Text, Posted FROM chat_line.discord_150782269382983689 WHERE User_Alias = ${userID} ORDER BY ID ${direction} LIMIT 1)
						UNION ALL
						(SELECT Text, Posted FROM chat_line.cerebot WHERE User_Alias = ${userID} ORDER BY ID ${direction} LIMIT 1)
					) AS T
					ORDER BY Posted ${direction}
					LIMIT 1`
				)
				.fetch()
			)[0];
		}
		else if (channel === "nasabot") {
			rs = (await new Recordset()
				.raw(`SELECT * FROM (
						(SELECT Text, Posted FROM chat_line.nasabot WHERE User_Alias = ${userID} ORDER BY ID ${direction} LIMIT 1)
						UNION ALL
						(SELECT Text, Posted FROM chat_line._core54_1464148741723 WHERE User_Alias = ${userID} ORDER BY ID ${direction} LIMIT 1)
					) AS T
					ORDER BY Posted ${direction}
					LIMIT 1`
				)
				.fetch()
			)[0];
		}
		else {
			rs = (await new Recordset()
				.db("chat_line")
				.select("Text", "Posted")
				.from(channel)
				.where("User_Alias = %n", userID)
				.orderBy("chat_line." + channel + ".ID " + direction)
				.limit(1)
				.fetch()
			)[0];
		}

		return (rs) 
			? ("(" + Utils.ago(rs.Posted) + ") " + rs.Text.replace(new RegExp(MasterClient.CFG.BAN_EVASION_CHARACTER, "g"), ""))
			: "No logs found for this user in this channel.";
	};

	const url = {
		crypto: "https://api.coinmarketcap.com/v1/ticker/?limit=1000",
		currency: "https://free.currencyconverterapi.com/api/v5/convert?compact=ultra&q=",
		quotes: "https://quotesondesign.com/wp-json/posts?filter[orderby]=rand&filter[posts_per_page]=1",
		hahaa: "https://icanhazdadjoke.com/",
		google: {
			geocode: "https://maps.googleapis.com/maps/api/geocode/json?key=" + process.env.GOOGLE_GEOCODING + "&address=",
			timezone: "https://maps.googleapis.com/maps/api/timezone/json?key=" + process.env.GOOGLE_TIMEZONES,
			ytExtended: `https://www.googleapis.com/youtube/v3/videos?part=contentDetails%2Cstatistics&key=${process.env.GOOGLE_YOUTUBE}&id=`
		},
		youtube: "https://randomyoutube.net/api/getvid?api_token=" + process.env.API_YOUTUBE_RANDOM,
		youtubeBackup: "http://www.randomyoutubecomment.com/",
		news: "https://newsapi.org/v2/top-headlines?apiKey=" + process.env.API_NEWS,
		urban: "https://api.urbandictionary.com/v0/define?term=",
		wiki: {
			search: "https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&redirects=1&titles=",
			random: "https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&format=json"
		},
		weather: {
			darksky: (type, lat, lon) => {
				let excluded = ["currently", "minutely", "hourly", "daily", "alerts"];
				excluded.splice(excluded.indexOf(type), 1);
				return "https://api.darksky.net/forecast/" + process.env.API_DARKSKY + "/" + lat + "," + lon + "?units=si&exclude=" + excluded.join(",");
			}
		},
		twitch: {
			updateChannel: () => "https://api.twitch.tv/kraken/channels/" + process.env.TWITCH_CHANNEL_ID + "?api_version=5",
			knownBot: () => "https://api.twitch.tv/kraken/users/68136884/chat?api_version=5&client_id=" + process.env.TWITCH_CLIENT_ID
		},
		twitchTools: {
			nameChange: (user) => "https://twitch-tools.rootonline.de/username_changelogs_search.php?format=json&q=" + user
		},
		funFact: "http://randomuselessfact.appspot.com/random.json?language=en",
		gdq: "http://taskinoz.com/gdq/api/",
		dictionary: (key) => `https://owlbot.info/api/v2/dictionary/${key}?format=json`,
		fortuneCookie: "http://www.yerkee.com/api/fortune"
	};

	let counters = {
		forsenE: 0
	};

	const COMMANDS = [
		// PLEB COMMANDS
		{ // ping
			name: "ping",
			aliases: ["supinic", "test", "uptime"],
			description: "Spaghetti code",
			level: 0,
			cooldown: 5,
			exec: (usr, arg, evt) => {
				const soft = new Date(MasterClient.SOFT_RESET_TIMESTAMP);
				const hard = new Date(MasterClient.HARD_RESET_TIMESTAMP);				
				evt.reply(
					"Spaghetti code has been running since "  + Utils.ago(hard) + " " +
					"and was last updated " + Utils.ago(soft) + ". " +
					MasterClient.emoji.spaghetti + " " + MasterClient.emoji.computer
				);
			}
		},
		{ // math
			name: "math",
			description: "Does math. Can do simple calculations (programming-style operators), simple functions (sin, cos, random, round, ...), unit conversion (12 inches to cm) and many more. For more info, check the documentation to mathJS",
			level: 0,
			cooldown: 3,
			exec: (usr, arg, evt) => {
				if (arg.length === 0) {
					evt.reply("You should specify what to calculate first. " + MasterClient.emoji.thinking_face);
					return NO_COOLDOWN_TRIGGERED;
				}

				evt.reply(MathJS.eval(arg.join(" ")));
			}
		},
		{ // crypto
			name: "crypto",
			description: "Active prices of somewhat popular crypto currencies",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const code = (arg[0] || "BTC").toUpperCase();
				const data = (await new Recordset()
					.db("crypto")
					.select("Date", "USD", "EUR", "Hourly_Change AS Hour", "Daily_Change AS Day", "Weekly_Change AS Week")
					.select("Currency.Code")
					.from("Currency_Price")
					.join("Currency", "crypto")
					.where("Code = %s OR Name = %s", code, code)
					.where("Is_Crypto = %b", true)
					.where("Date >= DATE_SUB(NOW(), INTERVAL 30 DAY)")
					.orderBy("Currency_Price.ID DESC")
					.limit(1)
					.fetch()
				)[0];

				if (!data) {
					evt.reply("Given currency has no tracked data in the past 30 days.");
					return;
				}

				evt.reply(
					data.Code + " " +
					Utils.ago(data.Date) +
					": " +
					"$" + data.USD + " / " +
					"€" + data.EUR + "; " +
					"Change: " +
					"1h " + data.Hour + "%, " +
					"24h " + data.Day + "%, " +
					"7d " + data.Week + "%"
				);
			}
		},
		{ // twitter
			name: "twitter",
			description: "Fetches the last tweet from a user",
			level: 0,
			cooldown: 10,
			blacklist: [CHAN.FORSEN],
			exec: (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("You must supply a username. :z");
					return NO_COOLDOWN_TRIGGERED;
				}

				Twitter.lastUserTweets(arg[0], (text) => evt.reply(text.replace(/\n/g, "")));
			}
		},
		{ // haHAA
			name: "haHAA",
			description: "Posts a random haHAA joke",
			level: 0,
			cooldown: 15,
			exec: async (usr, arg, evt) => {
				const data = await Utils.request({
					headers: { "Accept": "application/json", },
					uri: url.hahaa
				});

				evt.reply(JSON.parse(data).joke + " haHAA");
			}
		},
		{ // comment
			name: "comment",
			description: "Fetches a random comment from a random youtube video",
			level: 0,
			cooldown: 30,
			exec: async (usr, arg, evt) => {
				const EXTRACT_REGEX = /.*<span.*?>(.*?)<\/span>/;
				const data = await Utils.request({
					url: url.youtubeBackup,
					headers: {
						"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.95 Safari/537.36"
					},
					agentOptions: {
						rejectUnauthorized: false
					}
				});

				const match = data.match(EXTRACT_REGEX);
				if (match === null) {
					evt.reply("There was no comment?");
				}
				else {
					evt.reply(fixHTML(match[1]));
				}
			}
		},
		{ // news
			name: "news",
			description: "Fetches short articles. You can use a 2 character abbreviation to get country specific news, or any other word as a search query",
			// https://pastebin.com/Yicmk8Gw",
			level: 0,
			cooldown: 15,
			exec: async (usr, arg, evt) => {
				let query = "";
				let defaultLang = "&language=en";

				if (/^[A-Z]{2}$/i.test(arg[0])) {
					if (ExtraNews.quickCheck(arg[0])) {
						const reply = await ExtraNews.fetch(arg[0]);
						evt.reply(reply);
						return;
					}

					defaultLang = "";
					query += "&country=" + arg[0];
					arg.splice(0, 1);
				}

				if (arg.length !== 0) {
					query += "&q=";
					for (let param of arg) {
						query += param;
					}
				}

				if (!query) {
					query = "&country=US";
				}

				const data = JSON.parse(await Utils.request(url.news + query.replace(/#/g, "") + defaultLang));		
				if (!data.articles) {
					evt.reply("No data returned...?");
					return;
				}

				if (data.articles.length === 0) {
					evt.reply("No articles found.");
					return;
				}

				let headline = Utils.randArray(data.articles);
				let title = fixHTML(headline.title || "");
				let text = (title ? ". " : "") + Utils.safeWrap(Utils.removeHTML(fixHTML(headline.description)), 300);

				evt.reply(title + text);
			}
		},
		{ // urban
			name: "urban",
			description: "Posts the top definition of a given term from UrbanDictionary. You can use \"index:#\" after the query in order to look up definitions other than the most upvoted one",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				if (arg.join(" ").length === 0) {
					evt.reply("You should ask for a word...");
					return NO_COOLDOWN_TRIGGERED;
				}

				let index = 0;
				if (/index:\d+/.test(arg[arg.length - 1])) {
					index = Number(arg.pop().split(":")[1]);
				}

				const data = JSON.parse(await Utils.request(url.urban + Utils.argsToFixedURL(arg)));
				if (!data.list || data.result_type === "no_results") {
					evt.reply("No results found!");
					return;
				}

				const item = data.list.filter(i => i.word.toLowerCase() === arg.join(" ").toLowerCase())[index];
				if (!item) { 
					evt.reply("There is no definition with that index!");
					return;
				}

				const thumbs = "(+" + item.thumbs_up + "/-" + item.thumbs_down + ")";
				const example = (item.example)
					? (" - Example: " + item.example)
					: "";
					
				evt.reply(thumbs + " " + (item.definition + example).replace(/[\][]/g, ""));
			}
		},
		{ // wiki
			name: "wiki",
			description: "Writes the headline of the first article found by a search. If nothing is specified, fetches a random one instead",
			cooldown: 15,
			level: 0,
			exec: async (usr, arg, evt) => {
				let search = arg.join(" ");

				if (!search) {
					let data = await Utils.request(url.wiki.random);
					search = JSON.parse(data).query.random[0].title;
				}

				const rawData = await Utils.request(url.wiki.search + encodeURI(search));
				const data = JSON.parse(rawData).query.pages;
				const key = Object.keys(data)[0];

				if (key === "-1") {
					evt.reply("No results found!");
					return;
				}

				evt.reply(data[key].title + ": " + data[key].extract);
			}
		},
		{ // rl (randomline)
			name: "rl",
			aliases: ["randomline", "rq"],
			description: "Fetches a random chat line in the current channel. If a user is specified, searches for that user's logs only",
			level: 0,
			cooldown: 5,
			exec: async (usr, arg, evt) => {
				let line = null;
				const chan = evt.channel.getName().replace(/#/g, "");
				const targetUser = (arg[0] || "").toLowerCase().replace(/\\/g, "\\\\").replace(/'/g, "\\'");

				if (MasterClient.CFG.BANNED_LINE_USERS.has(targetUser)) {
					evt.reply("No.");
					return;
				}

				const connector = await Pool.getConnection();
				try {
					if (chan === "cerebot" || chan === "discord_150782269382983689") {
						if (targetUser) {
							await connector.query("CALL chat_line.RefugeWithUser('" + targetUser + "')");
							line = (await connector.query("SELECT * FROM chat_line.Random_Line_Cache ORDER BY ID DESC LIMIT 1"))[0];
						}
						else {
							await connector.query("CALL chat_line.RefugeNoUser()");
							line = (await connector.query("SELECT * FROM chat_line.Random_Line_Cache ORDER BY ID DESC LIMIT 1"))[0];
						}
					}
					else if (chan === "nasabot") {
						if (targetUser) {
							await connector.query("CALL chat_line.NasabotWithUser('" + targetUser + "')");
							line = (await connector.query("SELECT * FROM chat_line.Random_Line_Cache ORDER BY ID DESC LIMIT 1"))[0];
						}
						else {
							await connector.query("CALL chat_line.NasabotNoUser()");
							line = (await connector.query("SELECT * FROM chat_line.Random_Line_Cache ORDER BY ID DESC LIMIT 1"))[0];
						}
					}
					else {
						if (targetUser) {
							await connector.query("CALL chat_line.ChannelWithUser('" + targetUser + "', '" + chan + "')");
							line = (await connector.query("SELECT * FROM chat_line.Random_Line_Cache ORDER BY ID DESC LIMIT 1"))[0];
						}
						else {
							const randomData = await new Recordset().db("chat_line").select("MAX(ID) AS MaxID").from(chan).fetch();
							const table = "chat_line." + chan;
							line = (await new Recordset()
								.db("chat_line")
								.select("Name", "Text", "Posted")
								.from(chan)
								.join("User_Alias", "chat_data")
								.where(table + ".ID = %n", Math.floor(Math.random() * randomData[0].MaxID))
								.fetch()
							)[0];
						}
					}
				}
				catch (e) {
					console.log("Something messed up", e);
				}

				if (!line || line.Name === "No user found") {
					evt.reply("No logs found for that user in this channel.");
				}
				// else if (chan === "nasabot") {
				// 	evt.reply(`[${new Date().simpleDateTime()}] <${(line.Name || targetUser)}>: ${line.Text}`);
				// }
				else {
					const text = line.Text.replace(new RegExp(MasterClient.CFG.BAN_EVASION_CHARACTER, "g"), "");
					evt.reply("(" + Utils.ago(line.Posted) + ") <" + (line.Name || targetUser) + ">:  " + text);
				}

				await connector.end();
			}
		},
		{ // cl (countline)
			name: "cl",
			aliases: ["countline", "linecount"],
			description: "Counts the amount of chat lines sent by you, or the user you specified, in the current channel",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const chan = evt.channel.getName().toLowerCase().replace(/#/g, "");
				const targetUser = (arg[0] || usr).toLowerCase();
				let rs = null;

				if (chan === "cerebot" || chan === "discord_150782269382983689") {
					rs = await (new Recordset().select(`chat_line.RefugeCount('${targetUser}') AS Count`).fetch());
				}
				else if (chan === "nasabot") {
					rs = await (new Recordset().select(`chat_line.NasabotCount('${targetUser}') AS Count`).fetch());
				}
				else {
					rs = await (new Recordset()
						.db("chat_line")
						.select("COUNT(*) AS Count")
						.from(chan)
						.join("User_Alias", "chat_data")
						.where("Name = %s", targetUser)
						.fetch()
					);
				}

				const count = Number(rs[0].Count);
				if (count === 0) {
					evt.reply("That user has not said anything in this channel.");
				}
				else {
					evt.reply(
						((usr === targetUser) ? "You have" : (targetUser + " has")) +
						" sent " +
						count +
						"  lines in this channel so far."
					);
				}
			}
		},
		{ // clc (countlinechannel)
			name: "clc",
			aliases: ["countlinechannel", "linecountchannel"],
			description: "Counts the amount of chat lines in the current channel",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const chan = evt.channel.getName().toLowerCase().replace(/#/g, "");
				let rs = null;

				if (chan === "cerebot" || chan === "discord_150782269382983689") {
					rs = await (new Recordset().select("chat_line.RefugeTotalCount() AS Count").fetch());
				}
				else if (chan === "nasabot") {
					rs = await (new Recordset().select("chat_line.NasabotTotalCount() AS Count").fetch());
				}
				else {
					rs = await (new Recordset()
						.db("chat_line")
						.select("MAX(ID) AS Count")
						.from(chan)
						.fetch()
					);
				}

				const count = Number(rs[0].Count);
				if (count === 0) {
					evt.reply("This channel has no messages logged so far (?)");
				}
				else {
					evt.reply("This channel has " + count + " messages logged in the database so far.");
				}
			}
		},
		{ // fl (firstline)
			name: "fl",
			aliases: ["firstline"],
			description: "Sends the first line sent by you, or another user, in the context of the current channel",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const chan = evt.channel.getName().replace(/#/g, "");
				const targetUser = (arg[0] || usr).toLowerCase();
				const userData = (await new Recordset().db("chat_data").select("ID").from("User_Alias").where("Name = %s", targetUser).fetch())[0];

				if (!userData) {
					evt.reply("No such user exists in the database.");
					return;
				}

				const userID = Number(userData.ID);
				evt.reply(await firstOrLastLine(chan, userID, "FIRST"));
			}
		},
		{ // ll (lastline)
			name: "ll",
			aliases: ["lastline"],
			description: "Sends the last line sent by you, or another user, in the context of the current channel",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {				
				const chan = evt.channel.getName().replace(/#/g, "");
				const targetUser = (arg[0] || usr).toLowerCase();
				const userData = (await new Recordset().db("chat_data").select("ID").from("User_Alias").where("Name = %s", targetUser).fetch())[0];

				if (!userData) {
					evt.reply("No such user exists in the database.");
					return;
				}

				const userID = Number(userData.ID);
				evt.reply(await firstOrLastLine(chan, userID, "LAST"));
			}
		},
		{ // rla (rl athene)
			name: "rla",
			description: "Fetches a random chat line from athene's chat. No guarantees on the line being sent by an actual human being",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const line = (await new Recordset()
					.db("chat_line")
					.select("Text")
					.from("athenelive")
					.join({
						raw: "(SELECT FLOOR(RAND() * MAX(ID)) AS Random_ID FROM chat_line.athenelive) AS _"
					})
					.where("Random_ID = athenelive.ID")
					.fetch()
				)[0];

				evt.reply(line.Text);
			}
		},
		{ // rln (rl ninja)
			name: "rln",
			description: "Fetches a random chat line from ninja's chat. No guarantees on the line being sent by a person older than 13",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const line = (await new Recordset()
					.db("chat_line")
					.select("Text")
					.from("ninja")
					.join({
						raw: "(SELECT FLOOR(RAND() * MAX(ID)) AS Random_ID FROM chat_line.ninja) AS _"
					})
					.where("Random_ID = ninja.ID")
					.fetch()
				)[0];

				evt.reply(line.Text);
			}
		},
		{ // rld (rl drdisrespect)
			name: "rld",
			description: "Fetches a random chat line from drdisrespect's chat. No guarantees on the line being sent by a translucent person",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const line = (await new Recordset()
					.db("chat_line")
					.select("Text")
					.from("drdisrespectlive")
					.join({
						raw: "(SELECT FLOOR(RAND() * MAX(ID)) AS Random_ID FROM chat_line.drdisrespectlive) AS _"
					})
					.where("Random_ID = drdisrespectlive.ID")
					.fetch()
				)[0];

				evt.reply(line.Text);
			}
		},
		{ // id (user id)
			name: "id",
			aliases: ["mn", "myid", "mynumber"],
			description: "Checks your (or someone else's) ID in the database of users - the lower the number, the earlier the bot saved the user",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				const isNumber = !Number.isNaN(Number(arg[0]));
				const target = (arg[0] || "").toLowerCase() || usr;
				
				const data = (await new Recordset()
					.db("chat_data")
					.select("ID", "Name", "Started_Using AS Started")
					.from("User_Alias")
					.where({condition: isNumber}, "ID = %n", Number(target))
					.where({condition: !isNumber}, "Name = %s", target)
					.fetch()
				)[0];

				if (!data) {
					evt.reply("No data for given user.");
				}
				else if (data.Name === usr) {
					evt.reply("Your ID is " + data.ID + ", and were first seen " + Utils.ago(data.Started) + ".");
				}
				else {
					evt.reply("That person's ID is " + data.ID + ", and they were first seen " + Utils.ago(data.Started) + ".");
				}
			}
		},
		{ // translate
			name: "translate",
			description: "Implicitly translates from auto-recognized language to English. Supports parameters 'from' and 'to'. Example: " + COMMAND_PREFIX + "translate from:german to:french Guten Tag",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				if (arg.length === 0) {
					evt.reply("You need to supply something to translate.");
					return;
				}

				let options = {from: "auto", to: "en"};
				for (let i = 0; i < 2; i++) {
					if (/^(from|to):.*$/.test(arg[0])) {
						let [option, lang] = arg[0].split(":");
						let newLang = lang;

						if (!TranslateLanguages[newLang]) {
							newLang = TranslateLanguages.getCode(newLang);
						}

						if (!newLang) {
							evt.reply("The language \"" + lang + "\" was not recognized :z");
							return;
						}

						options[option] = newLang.toLowerCase();
						arg.splice(0, 1);
					}
				}

				const res = await GoogleTranslate(arg.join(" "), options);
				
				const fromLanguage = TranslateLanguages[options.from] || TranslateLanguages[res.from.language.iso.toLowerCase()];
				const direction = fromLanguage + " -> " + TranslateLanguages[options.to];
				evt.reply(direction + ": " + res.text);
			}
		},
		{ // weather
			name: "weather",
			description: "Weather info for any location. For forecast, add \"hour+#\" or \"day+#\" for specific hour or day. Powered by Darksky",
			level: 0,
			cooldown: 15,
			exec: async (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("You have to input a place first.");
					return NO_COOLDOWN_TRIGGERED;
				}

				let number = null;
				let type = "currently";
				if (arg[arg.length - 1].has("-")) {
					evt.reply("Checking for weather history is not currently implemented");
					return NO_COOLDOWN_TRIGGERED;
				}
				else if (DARKSKY_WEATHER_REGEX.test(arg[arg.length - 1])) {
					const match = arg.pop().match(DARKSKY_WEATHER_REGEX);
					
					if (match[2]) { // +<number> = shift by X, used in daily/hourly
						number = Number(match[3]);
						type = (match[1] === "day") ? "daily" : (match[1] === "hour") ? "hourly" : null;

						if (!type || (type === "daily" && number > 7) || (type === "hourly" && number > 48)) {
							evt.reply("Invalid combination of parameters.");
							return NO_COOLDOWN_TRIGGERED;
						}
					}
					else { // summary
						type = (match[1] === "day") ? "hourly" : (match[1] === "hour") ? "minutely" : "daily";
					}					
				}

				const geoData = JSON.parse(await Utils.request(url.google.geocode + Utils.argsToFixedURL(arg)));

				if (!geoData.results[0]) {
					evt.reply("That place was not found FeelsBadMan");
					return;
				}

				const coords = geoData.results[0].geometry.location;
				const topData = JSON.parse(await Utils.request(url.weather.darksky(type, coords.lat, coords.lng)));
				
				console.log("Weather data", topData);

				let data = null;
				let msg = null;
				if (number === null && type !== "currently") {
					msg = topData[type].summary;
				}
				else {
					data = (type === "currently") 
						? topData.currently
						: topData[type].data[number];

					const precip = (data.precipProbability === 0)
						? "No precipitation expected."
						: (Utils.round(data.precipProbability * 100) + "% chance of " + Utils.round(data.precipIntensity, 2) + " mm " + data.precipType + ".");
					const temp = (type !== "daily")
						? (Utils.round(data.temperature, 2) + "°C")
						: ("Temperatures: " + Utils.round(data.temperatureMin) + "°C to " + Utils.round(data.temperatureMax) + "°C");
					const storm = (type === "currently") 
						? (typeof data.nearestStormDistance !== "undefined")
							? ("Nearest storm is " + data.nearestStormDistance + " km away. ")
							: ("No storms nearby. ")
						: "";

					msg = data.summary + ". " +
						temp + ". " +
						((type === "currently") ? ("Feels like " + Utils.round(data.apparentTemperature) + "°C. ") : "") +
						storm +
						Utils.round(data.cloudCover * 100) + "% cloudy. " +
						"Wind gusts up to " + Utils.round(data.windGust * 3.6) + " km/h. " +
						Utils.round(data.humidity * 100) + "% humidity. " +
						precip;
				}

				let plusTime = "";
				if (typeof number === "number") {
					const time = new Date(topData[type].data[number].time * 1000).setTimezoneOffset(topData.offset);
					if (type === "hourly") {
						plusTime = " (" + Utils.zf(time.getHours(), 2) + ":00 local time)";
					}
					else {
						plusTime = " (" + time.getDate() + "." + (time.getMonth() + 1) + ". local date)";
					}
				}
				else if (type === "currently") {
					plusTime = " (now)";
				}
				else {
					plusTime = " (" + type + " summary)";
				}

				evt.reply(geoData.results[0].formatted_address + plusTime + ": " + msg);
			}
		},
		{ // tuck
			name: "tuck",
			description: "Tucks selected user to bed",
			level: 0,
			cooldown: 5,
			exec: (usr, arg, evt) => {
				if (arg[0] && arg[0][0] === "@") {
					arg[0] = arg[0].substring(1);
				}

				arg[0] = (arg[0] || "").toLowerCase();

				if (!arg[0] || arg[0] === usr) {
					evt.reply("You had nobody to tuck you in, so you tucked yourself in PepeHands");
				}
				else if (arg[0] === "supibot") {
					evt.reply("Thanks for the kind gesture, but I gotta stay up :)");
				}
				else {
					evt.reply("You tucked " + arg[0] + " into bed FeelsOkayMan 👉 🛏");
				}
			}
		},
		{ // time
			name: "time",
			description: "Determines the timezone(s) for a given location",
			level: 0,
			cooldown: 30,
			exec: async (user, arg, evt) => {
				if (arg.length === 0) {
					evt.reply("You must search for something first.");
					return;
				}

				const geoData = JSON.parse(await Utils.request(url.google.geocode + arg.join("+")));
				if (!geoData.results[0]) {
					evt.reply("That place was not found FeelsBadMan");
					return;
				}

				const now = new Date();
				const latLong = geoData.results[0].geometry.location.lat + "," + geoData.results[0].geometry.location.lng;
				const timeZoneURL = url.google.timezone + "&timestamp=" + Math.trunc(now / 1000) + "&location=" + latLong;

				const timeData = JSON.parse(await Utils.request(timeZoneURL));
				const totalOffset = (timeData.rawOffset + timeData.dstOffset);
				const offset = (totalOffset >= 0 ? "+" : "-") + Math.trunc(Math.abs(totalOffset) / 3600) + ":" + Utils.zf((Math.abs(totalOffset) % 3600) / 60, 2);

				now.setTime(now.valueOf() + totalOffset * 1000);
				const time = Utils.zf(now.getUTCHours(), 2) + ":" + Utils.zf(now.getUTCMinutes(), 2) + ":" + Utils.zf(now.getUTCSeconds(), 2);

				const string =
					arg.join(" ") + " is currently observing " + timeData.timeZoneName + ", " +
					"which is GMT" + offset + ". " +
					"Right now it's " + time + " there.";

				evt.reply(string);
			}
		},
		{ // currency
			name: "currency",
			description: "Attempts to convert a specified amount of one currency to another. Only supports 3-letter ISO codes (for now) Example: '100 USD to EUR'",
			level: 0,
			cooldown: 15,
			exec: async (usr, arg, evt) => {
				const params = arg.join(" ").split(" to ");
				if (params.length !== 2) {
					evt.reply("You need to supply exactly two currencies, and separate them with 'to'");
					return;
				}

				let [amount, from] = params[0].split(" ");
				const to = params[1];
				if (!from) {
					from = amount;
					amount = 1;
				}

				const currencySymbol = from.toUpperCase() + "_" + to.toUpperCase();
				if (!(/[A-Z]{3}_[A-Z]{3}/.test(currencySymbol))) {
					evt.reply("Both currencies must be represented by 3 letters");
					console.log(currencySymbol);
					return;
				}

				const data = await Utils.request(url.currency + currencySymbol);
				const ratio = JSON.parse(data)[currencySymbol];
				if (typeof ratio === "number") {
					evt.reply(amount + " " + from + " = " + Utils.round(amount * ratio, 3) + " " + to);
				}
				else {
					evt.reply("One or both currencies were not recognized");
				}
			}
		},
		{ // whereis
			name: "whereis",
			description: "Attempts to find the given query",
			level: 0,
			cooldown: 15,
			exec: async (user, arg, evt) => {
				if (arg.length === 0) {
					evt.reply("You must search for something first.");
					return NO_COOLDOWN_TRIGGERED;
				}

				const afkData = MasterClient.USER_AFK_DATA[arg.join(" ").toLowerCase()];
				if (afkData) {
					const silent = (afkData.silent) ? " (via WNMAB)" : "";
					evt.reply("That user is currently AFK" + silent + ": " + afkData.text + " - since " + Utils.ago(new Date(afkData.date)));
					return;
				}

				const check = arg[0].toLowerCase();
				if (check === "supinic") {
					evt.reply("You have been banned from The Supibot Club for inappropriate pinging nymnWeird");
				}
				else if (check === "supibot") {
					evt.reply("Really? I'm right here Kappa");
				}
				else if (check === "zigglie") {
					evt.reply("Working out at the local gym gachiGASM");
				}
				else if (check === "karatheon") {
					const hour = new Date().getHours();
					const meals = ["gnocchi", "ravioli", "ribolitta", "pizza", "lasagna", "ragu", "tiramisu"< "spaghetti", "gelato", "risotto", "carbonara"];
					evt.reply(
						"Currently in his kitchen, making some " +
						meals[hour % meals.length] + " " +
						"OpieOP"
					);
				}
				else if (check === "domman") {
					const day = new Date().getDay();
					const teas = ["Earl Grey", "Darjeeling", "breakfast", "green", "gunfire", "oolong", "Pu'erh"];
					evt.reply(
						"In the lounge. At the moment, enjoying a smol cup of some " +
						teas[(day || 7) - 1] + " tea" +
						(day === 5 ? " 🥃 " : " ") +
						"pepeL 🍵"
					);
				}
				else if (check === "forsen") {
					let now = new Date();
					const online = (now.getHours() >= 18 || now.getHours() === 0);

					if (now.getFullYear() === 2018 && now.getMonth() === 7 && (now.getDate() >= 2 && now.getDate() <= 5)) {
						const nextOnline = new Date("2018-08-06 18:00:00+0200");
						evt.reply("Attending Savjz's wedding forsenE Actually, practicing Boshy off-stream Kapp Back " + Utils.future(nextOnline));
						return;
					}

					if (online) {
						evt.reply("He should be online forsenE");
					}
					else {
						const friday = (now.getDay() === 5) ? " Friday GachiPls DAY OFF" : "";
						now.setHours(18);
						now.setMinutes(0);
						evt.reply("He should be online " + Utils.future(now) + ", give or take an hour forsenE " + friday);
					}
				}
				else if (check === "nymn") {
					const now = new Date();

					if (now.getFullYear() === 2018 && now.getMonth() === 7 && now.getDate() < 13) {
						evt.reply("On a vacation until August 12 FeelsGoodMan Clap");
					}
					else {
						evt.reply("Polishing Radio Kappa GachiPls");
					}
				}
				else if (check === "billy"  || check === "billy herrington") {
					evt.reply("In heaven, wrestling with angels PepeHands");
				}
				else if (check.has("astolfo")) {
					evt.reply("FeelsBadMan he's just taking a break from twitch");
				}
				else if (check.has("elon____musk")) {
					if (evt.channel.getName() === "#forsen") {
						evt.reply("Not here PepeS");
					}
					else {
						evt.reply("forsen what up sissy, can not stand losing ingame? LULW I see that your viewer count dropped too LULW P.S. I bought Spain");
					}
				}
				else {
					try {
						const place = arg.join("+").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
						const geoData = JSON.parse(await Utils.request(url.google.geocode + place));

						if (!geoData.results[0]) {
							evt.reply("That place was not found FeelsBadMan");
							return;
						}

						evt.reply("\"" + arg.join(" ") + "\" is located here: " + geoData.results[0].formatted_address);
					}
					catch (e) {
						evt.reply("An error occured monkaS");
						console.log("WHEREIS error", e);
					}
				}
			}
		},
		{ // bancheck
			name: "bancheck",
			description: "Checks whether the posted message is against the rules in a specified channel. If no channel is provided, checks #forsen",
			level: 0,
			blacklist: [CHAN.FORSEN, CHAN.NYMN],
			exec: async (usr, arg, evt) => {
				if (arg.length === 0) {
					evt.reply("You need to post a message to check first");
					return NO_COOLDOWN_TRIGGERED;
				}

				let channel = "#forsen";
				if (arg[0].charAt(0) === "#") {
					if (arg[0] in MasterClient.CFG.BANPHRASE_API_URL) {
						channel = arg[0];
						arg.shift();
					}
					else {
						evt.reply("There is no banphrase API that supports the given channel.");
						return;
					}
				}

				const banned = await Utils.pajladaCheck(arg.join(" "), channel, MasterClient.CFG);
				console.log("bancheck result", banned);

				evt.reply((!banned)
					? "That message will not cause an automated timeout MrDestructoid"
					: "The phrase \"" + banned.phrase + "\" will get you auto-timed out " + banned.emote
				);
			}
		},
		{ // afk (gn)
			name: "afk",
			aliases: ["gn"],
			description: "Flags you as AFK for other people to see. Also supports a custom message",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt, silent) => {
				const text = arg.join(" ")
					|| (evt.cmd === "gn"
						? "Good night " + MasterClient.emoji.bed
						: "(no message)"
				);

				const userData = (await new Recordset()
					.db("chat_data")
					.select("ID")
					.from("User_Alias")
					.where("Name = %s", usr.toLowerCase())
					.fetch()
				)[0];

				if (!userData) {
					(!silent) && evt.reply("You are too new in this chat, please lurk more");
					return;
				}

				const now = new Date();
				const row = await new Row("chat_data", "AFK");
				row.setValues({
					User_Alias: userData.ID,
					Text: text,
					Silent: !!silent
				});
				
				await row.save();

				MasterClient.USER_AFK_DATA[usr.toLowerCase()] = {
					id: row.ID,
					text: text,
					date: now,
					silent: !!silent
				};
				(!silent) && evt.reply(usr + " is now AFK: " + text);
			}
		},
		{ // afkcheck
			name: "afkcheck",
			aliases: ["isafk"],
			description: "Checks if an user is AFK",
			level: 0,
			cooldown: 15,
			exec: async (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("Check for someone first.");
					return NO_COOLDOWN_TRIGGERED;
				}

				const afkData = (await new Recordset()
					.db("chat_data")
					.select("Text", "Date")
					.from("AFK")
					.join("User_Alias", "chat_data")
					.where("User_Alias.Name = %s", arg[0].toLowerCase())
					.where("AFK.Active = %b", true)
					.orderBy("AFK.ID DESC")
					.limit(1)
					.fetch()
				)[0];

				if (!afkData) {
					evt.reply("That user is not AFK.");
					return;
				}

				evt.reply("That user is currently AFK: " + afkData.Text + " (since " + Utils.ago(afkData.Date) + ")");
			}
		},
		{ // funfact
			name: "funfact",
			description: "Fetches a random fun fact",
			level: 0,
			cooldown: 60,
			exec: async (usr, arg, evt) => {
				try {
					const data = await Utils.request(url.funFact);
					evt.reply(JSON.parse(data).text);
				}
				catch (e) {
					evt.reply("The API went down FeelsBadMan");
				}
			}
		},
		{ // speedrun
			name: "speedrun",
			description: "Posts a random, scrambled \"speedrun\" donation text",
			level: 0,
			cooldown: 15,
			blacklist: [CHAN.FORSEN],
			exec: async (usr, arg, evt) => {
				const data = await Utils.request(url.gdq);
				evt.reply(data);
			}
		},
		{ // copypasta
			name: "copypasta",
			description: "Pulls a random copypasta",
			level: 0,
			cooldown: 15,
			blacklist: [CHAN.FORSEN],
			exec: async (usr, arg, evt) => {
				const pastaRegex = /quote_display_content_0">(.+?)<\/span>/;
				//const dateRegex = /class="-date">(.+)?<\/span/; 

				const data = await Utils.request("https://www.twitchquotes.com/random");
				const copypasta = (data.match(pastaRegex) || [])[1];
				evt.reply(copypasta || "No copypasta found.");
			}
		},
		{ // suggest
			name: "suggest",
			description: "Suggest a feature for Supibot. You can also use " + COMMAND_PREFIX + "suggest check <ID> to see the progress",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				if  (usr === "shine_blind" || usr === "shineblind") {
					return evt.reply("No.");
				}

				const msg = arg.join(" ");
				const userData = (await new Recordset().db("chat_data").select("ID").from("User_Alias").where("Name = %s", usr).fetch())[0];
				if (!userData) {
					evt.reply("You are too new in this chat, please lurk more");
					return;
				}
				
				const connector = await Pool.getConnection();
				const insertData = await connector.query(`INSERT INTO data.Suggestion (User_Alias, Text) VALUES (${userData.ID}, "${msg.replace(/"/g, "\\\"")}")`);
				await connector.end();	

				evt.reply("Your suggestion has been added with ID " + insertData.insertId + " and will be eventually processed.");	
			}
		},
		{ // boshy
			name: "boshy",
			level: 0,
			cooldown: 5,
			whitelist: [CHAN.FORSEN],
			exec: (usr, arg, evt) => {
				const sonicStart = 6620;
				const sonicEnd = 10664; 
				const skeletonStart = 11334;
				const skeletonEnd = 11603;
				const megamanStart = 12244;	
				const megamanEnd = 12760;	
				const mortalKombatStart = 13977;
				const mortalKombatEnd = 14307;
				const ganonStart = 14768;
				const ganonEnd = 14830;
				const missingnoStart = 17268; 
				const missingnoEnd = 17497;
				const solgrynStart = 18973;
				const solgrynEnd = solgrynStart + 2041;

				evt.reply(
					// "Deaths: " +
					"Sonic: " + (sonicEnd - sonicStart) +
					" W6: " + (skeletonStart - sonicEnd) + 
					" Skeleton: " + (skeletonEnd - skeletonStart) +
					" W7: " + (megamanStart - skeletonEnd) +
					" Megaman: " + (megamanEnd - megamanStart) +
					" W8: " + (mortalKombatStart - megamanEnd) +
					" MK: " + (mortalKombatEnd - mortalKombatStart) + 
					" W9:" + (ganonStart - mortalKombatEnd) +
					" Ganon: " + (ganonEnd - ganonStart) +
					" W10: " + (missingnoStart - ganonEnd) + 
					" Missingno: " + (missingnoEnd - missingnoStart) + 
					" W11: " + (solgrynStart - missingnoEnd) +
					" Solgryn: " + (solgrynEnd - solgrynStart) + 
					"; for a total of " + solgrynEnd + ". LOST TO OATMEAL OMEGALUL"
				);
			}
		},
		{ // cookie
			name: "cookie",
			description: "Open a fortune cookie",
			level: 0,
			cooldown: 5,
			exec: async (usr, arg, evt) => {
				const now = Date.now();
				if (MasterClient.CFG.FORTUNE_COOKIES[usr] > now) {
					evt.reply("You can eat your next daily cookie " + Utils.future(MasterClient.CFG.FORTUNE_COOKIES[usr]));
					return;
				}

				const data = (await new Recordset()
					.db("data")
					.select("Text")
					.from("Fortune_Cookie")
					.orderBy("RAND() DESC")
					.limit(1)
					.fetch()
				)[0];

				evt.reply(data.Text);
				MasterClient.CFG.FORTUNE_COOKIES[usr] = now + MasterClient.CFG.FORTUNE_COOKIE_TIMEOUT;
			}
		},
		{ // origin
			name: "origin",
			description: "Find an origin of a given emote. You can suggest your own by using " + COMMAND_PREFIX + "origin add <emote> <description>",
			level: 0,
			cooldown: 10,
			exec: async (usr, arg, evt) => {
				if (arg[0] === "add") {
					// evt.reply("This is now deprecated, use the website form at supinic dot com");
					
					arg.shift();
					const emote = arg.shift();
					const description = arg.join(" ");
					const userData = (await new Recordset().db("chat_data").select("ID").from("User_Alias").where("Name = %s", usr.toLowerCase()).fetch())[0];

					if (!userData.ID) {
						evt.reply("You are too new in this chat, please lurk more");
						return;
					}

					const row = await new Row("data", "Origin");
					row.setValues({
						Name: emote,
						Text: description,
						User_Alias: userData.ID,
						Approved: (usr === "supinic")
					});
					await row.save();

					if (usr !== "supinic") {
						evt.reply("Your suggestion has been successfully added with ID " + row.ID + " and is now awaiting approval :)");
					}
					else {
						evt.reply("Your suggestion has been successfully added with ID " + row.ID + " and was auto-approved :D");
					}
				}
				else {
					const target = arg.join(" ");
					const lower = target.toLowerCase();
					if (!target) {
						evt.reply("You have to search for something first.");
						return NO_COOLDOWN_TRIGGERED;
					}

					let data = (await new Recordset()
						.db("data")
						.select("Name", "Text", "Todo", "Approved")
						.from("Origin")
						.where("LOWER(Name) = %s", lower)
						.where("Deleted = %b", false)
						.orderBy("ID DESC")
						.fetch()
					);

					if (data.length > 1) {
						data = data.filter(i => i.Name === target)[0];
					}
					else {
						data = data[0];
					}

					if (!data) {
						evt.reply("No such definition has been found!");

					}
					else if (!data.Approved) {
						evt.reply("A definition exists, but has not been approved yet...");
					}
					else {
						let string = data.Text;
						if (data.Todo) {
							string = "(TODO) " + string;
						}

						evt.reply(string);
					}
				}
			}
		},
		{ // forsenE
			name: "forsenE",
			description: "forsenE",
			cooldown: 5,
			level: 0,
			exec: (usr, arg, evt) => {
				const forsenE = [
					"Is the drdisrespect shooting connected to call of duty? Correct me if Im wrong but isn’t the scene just filled with wannabe thugs console shitters?",
					"Not sure if I formulated bad or people didnt get it. Im asking if its likely to be a hardcore call of duty nerd. That came with the 40-60k viewership increase. You always hear threaths and fights and shit go down in that community.",
					"amazon blocked my account now they want an bank statement that shows the given payment cards last 4 numbers to unlock the account. Swedish bank statements dont show that? Is that a normal thing?",
					"Prolly getting a mini fridge too for caffeine and snus. Would @redbullesports or @MonsterGaming like to sponsor me? Preferably Red bull since Monster tastes like ass.",
					"65 inch tv, mounted on wall or not ? what are some pros and cons. really slim sony one if that matters.",
					"b.",
					"ehm I didnt tweet this , must have \"fat fingered\"  while putting it down. anyway good morning I guess"
				];

				evt.reply(forsenE[counters.forsenE++ % forsenE.length] + " forsenE");
			}
		},
		{ // rg (randomgachi)
			name: "rg",
			aliases: ["randomgachi"],
			description: "Fetches a random gachi track",
			cooldown: 5,
			level: 0,
			exec: async (usr, arg, evt) => {
				const linkPrefix = (await new Recordset().select("Link_Prefix").from("data.Video_Type").where("ID = %n", 1).fetch())[0].Link_Prefix;
				const data = (await new Recordset()
					.select("Name", "Link", "Youtube_Link", "Video_Type", "Author", "Published")
					.from("data.Gachi")
					.where("Video_Type = %n OR Youtube_Link IS NOT NULL", 1)
					.orderBy("RAND()")
					.limit(1)
					.fetch()
				)[0];

				const link = linkPrefix.replace("$", (data.Video_Type === 1) ? data.Link : data.Youtube_Link);
				if (evt.channel.getName() === "#supinic" && MasterClient.CFG.SONG_REQUEUST_ENABLED) {
					COMMANDS.find(i => i.name === "sr").exec(usr, [link], evt);
				}
				else {
					evt.reply(`Here's your random gachi: ${link} ("${data.Name}" by ${data.Author}, published on ${data.Published.format("Y-m-d")}) gachiGASM`);
				}
			}
		},
		{ // dict (dictionary)
			name: "dict",
			aliases: ["dictionary"],
			description: "Fetches the description of a term. Use a number at the end should you get multiple results",
			cooldown: 10,
			level: 0,
			exec: async (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("Why are you looking up the definition of nothing? PepeLaugh");
					return;
				}

				let ID = null;
				if (!Number.isNaN(Number(arg.last()))) {
					ID = Number(arg.pop()) - 1;
				}

				const data = JSON.parse(await Utils.request(url.dictionary(Utils.argsToFixedURL(arg, "_"))));
				if (data.length === 0) {
					evt.reply("There is no such defintion.");
				}
				else if (data.length === 1) {
					evt.reply(`(${data[0].type}): ${data[0].definition}`);
				}
				else {
					if (ID === null) {
						evt.reply("There are " + data.length + " definitions, please run the same query again with your specified ID");
					}
					else if (ID < 0 || ID >= data.length) {
						evt.reply("Your specified ID is out of bounds");
					}
					else {
						evt.reply(`(${data[ID].type}): ${data[ID].definition}`);
					}
				}
			}
		},
		{ // gc gachicheck
			name: "gc",
			aliases: ["gachicheck"],
			description: "Checks if a given gachi link exists in the database, if not, adds it to the todo list",
			level: 0,
			cooldown: 5,
			exec: async (usr, arg, evt) => {
				if (!arg[0]) {
					return evt.reply("You have to check for something first");
				}

				let link = null;
				let type = null;
				if (/youtube|youtu.be/.test(arg[0])) {
					type = 1;
					link = arg[0].match(/([A-Za-z0-9_-]{11})/)[1];
				}
				else if (/vimeo/.test(arg[0])) {
					type = 4;
					link = arg[0].match(/(\d+)/)[1];
				}
				else if (/nicovideo/.test(arg[0])) {
					type = 21;
					link = arg[0].match(/([sn]m\d+)/)[1];
				}
				else if (/bilibili/.test(arg[0])) {
					type = 22;
					link = arg[0].match(/(av\d+)/)[1];
				}
				else if (/soundcloud/.test(arg[0])) {
					type = 3;
					link = arg[0].match(/(soundcloud.com\/[\w-]+\/[\w-]+)/)[1];
					if (link) {
						link = "https://" + link;
					}
				}

				if (!link) {
					return evt.reply("Unrecognized or malformed link!");
				}

				const check = (await new Recordset()
					.select("ID", "Link", "Youtube_Link")
					.from("data.Gachi")
					.where("Link = %s OR Youtube_Link = %s", link, link)
					.fetch()
				)[0];

				if (check) {
					const msg = "Link is in main list, as the " + ((check.Link === link) ? "main" : "youtube reupload") + " link for ID " + check.ID;
					evt.reply(msg);
				}
				else {
					const todoCheck = (await new Recordset()
						.select("ID", "Notes", "Rejected")
						.from("data.Gachi_Todo_List")
						.where("Link = %s", link)
						.fetch()
					)[0];

					if (todoCheck) {
						let msg = null;

						if (todoCheck.Rejected === 1) {
							msg = "Link has been rejected. Reason: " + (todoCheck.Notes || "N/A");
						}
						else {
							msg = "Link is in todo list as ID " + todoCheck.ID + ", waiting to be processed";
						} 
						evt.reply(msg);
					}
					else {
						const userData = (await new Recordset().db("chat_data").select("ID").from("User_Alias").where("Name = %s", usr.toLowerCase()).fetch())[0];
						const row = await new Row("data", "Gachi_Todo_List");
						row.setValues({
							Link: link,
							Added_By: userData.ID,
							Video_Type: type
						});
						await row.save();

						evt.reply("No record found in either list. Saved as ID " + row.ID + " in the todo list");
					}
				}
			}
		},
		{ // gachi
			name: "gachi",
			description: "Fetches the links to the gachi list",
			cooldown: 10,
			level: 0,
			exec: async (usr, arg, evt) => {
				evt.reply("Main list: https://supinic.com/gachi/list | Todo list: https://supinic.com/gachi/todo");
			}
		},
		{ // %
			name: "%",
			description: "Rolls a random number 0-100",
			cooldown: 2.5,
			level: 0,
			exec: async (usr, arg, evt) => {
				const number = Math.trunc(Math.random() * 10000) / 100;
				evt.reply(number + "%");
			}
		},



		// ---------------------------------------------------------------------------------
		// temporary commands
		
		{ // spam
			name: "spam",
			description: "?",
			level: 1e6,
			exec: (usr, arg, evt) => {
				const delay = Number.isNaN(Number(arg[0])) ? 100 : Number(arg[0]);
				evt.reply("Initiating a " + delay + "ms delay message spam in 3 seconds...");

				setTimeout(() => evt.reply("emote1 emote2"), 3000);
				setTimeout(() => evt.reply("emote3 emote4"), 3000 + delay);
			}
		},

		// ---------------------------------------------------------------------------------
		// DISCORD ONLY COMMANDS
		{ // cerebot
			name: "cerebot",
			description: "Sends a command to use for cerebot",
			whitelist: [CHAN.DISCORD],
			level: 0,
			exec: (usr, arg, evt) => {
				const msg = arg.join(" ").replace(/^\s+!/, "");
				if (!msg) {
					evt.reply("You should use a command");
				}
				else {
					evt.rawReply && evt.rawReply("!" + msg);
				}
			}
		},

		// ---------------------------------------------------------------------------------
		// SUPINIC STREAM ONLY commands
		{ // test-tts text to speech
			name: "test-tts",
			description: "TTS test",
			level: 1e6,
			cooldown: 15,
			whitelist: [CHAN.SUPINIC],
			exec: (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("You should ask for a TTS text.");
					return NO_COOLDOWN_TRIGGERED;
				}

				LocalRequest("POST", {
					action: "tts",
					msg: arg.join(" ")
				});
			}
		},
		{ // stream
			name: "stream",
			description: "Various stream configuration related commands",
			level: 1e6,
			cooldown: 5,
			whitelist: [CHAN.SUPINIC],
			exec: async (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("Pick a command first.");
					return NO_COOLDOWN_TRIGGERED;
				}

				const cmd = arg.shift().toLowerCase();
				let data = null;
				let method = null;
				let targetURL = null;
				let success = null;

				switch (cmd) {
					case "game":
						targetURL = url.twitch.updateChannel();
						method = "PUT";
						data = { channel: {
							game: arg.join(" ")
						}};
						success = "Game set successfully.";
						break;

					case "status": 
					case "title":
						targetURL = url.twitch.updateChannel();
						method = "PUT";
						data = { channel: {
							status: arg.join(" ")
						}};
						success = "Status set successfully.";
						break;

					case "hydrate": {
						const value = (arg.shift() === "true");
						if (value) {
							clearInterval(MasterClient.HYDRATION_MESSAGE.interval);
							MasterClient.HYDRATION_MESSAGE = {
								interval: setInterval(() => {
									const onlineSince = Utils.ago(MasterClient.HYDRATION_MESSAGE.start);
									const beverage = Math.floor((Date.now() - MasterClient.HYDRATION_MESSAGE.start) / 9e5) + "mL of alcohol.";
									MasterClient.send("#supinic", "You have went online cca. " + onlineSince + ", and by now, should have consumed at least " + beverage);
								}, 9e5),
								start: Date.now()
							};
						}
						else {
							clearInterval(MasterClient.HYDRATION_MESSAGE.interval);
							MasterClient.HYDRATION_MESSAGE.interval = null;
							MasterClient.HYDRATION_MESSAGE.start = null;
						}

						evt.reply("Hydration messages are now " + (value ? "on" : "off"));
						return;
					}

					case "sr": {
						const value = (arg.shift() === "true");
						MasterClient.CFG.SONG_REQUEUST_ENABLED = value;
						evt.reply("Song requests are now " + (value ? "on" : "off"));
						return;
					}

					default:
						evt.reply("Unrecognized command.");
						return;
				}

				try {
					await Utils.request({
						url: targetURL,
						method: method,
						headers: {
							"Content-Type": "application/json",
							"Client-ID": process.env.TWITCH_CLIENT_ID,
							"Authorization": "OAuth " + process.env.TWITCH_OAUTH_EDITOR,
							"Accept": "application/vnd.twitchtv.v5+json"
						},
						body: JSON.stringify(data)
					});
					evt.reply(success);
				}
				catch (e) {
					evt.reply("Something went wrong.");
					console.log(targetURL, e.toString());
				}
			}
		},
		{ // sr (song)
			name: "sr",
			aliases: ["song"],
			description: "Requests a song on stream",
			level: 0,
			cooldown: 15,
			whitelist: [CHAN.SUPINIC],
			exec: async (usr, arg, evt) => {
				if (!MasterClient.CFG.SONG_REQUEUST_ENABLED) {
					evt.reply("Song requests are currently disabled.");
					return;
				}

				if (!arg[0]) {
					evt.reply("Search for something first.");
					return NO_COOLDOWN_TRIGGERED;
				}
				
				const dataYT = await Utils.fetchYoutubeVideo(arg.join(" "), process.env.GOOGLE_YOUTUBE);
				if (!dataYT) {
					evt.reply("No video matching that query has been found.");
				}
				else if (dataYT.length > 600) {
					evt.reply(`Video "${dataYT.name}" by ${dataYT.author} exceeds the maximum length! (600s)`);
				}
				else {
					console.log("Adding youtube vid", dataYT); 
					const id = await VLC.add(dataYT.link, usr);
					evt.reply(`Video "${dataYT.name}" by ${dataYT.author} successfully added to queue with ID ${id}!`);
					VLC.extraData[id] = {
						length: dataYT.length
					};
				}
			}
		},
		{ // playlist
			name: "playlist",
			description: "Posts info about the current playlist length",
			level: 0,
			cooldown: 15,
			whitelist: [CHAN.SUPINIC],
			exec: async (usr, arg, evt) => {
				const data = await VLC.playlistLength();
				evt.reply(
					"The playlist has " + data.amount + " songs remaining, " +
					"for a total playtime of " + Utils.formatTime(data.length)
				);
			}
		},
		{ // current (now)
			name: "current",
			aliases: ["now"],
			description: "Posts info about the currently playing song",
			level: 0,
			cooldown: 15,
			whitelist: [CHAN.SUPINIC],
			exec: async (usr, arg, evt) => {
				const data = await VLC.currentlyPlaying();
				if (data.id === -1) {
					evt.reply(data.text);
				}
				else {
					evt.reply(data.text + " Current position: " + data.time + " out of " + data.length);
				}
			}
		},

		// ---------------------------------------------------------------------------------
		// CYTUBE RELATED COMMANDS
		{ // test-tts text to speech
			name: "c-playlist",
			aliases: ["cpl"],
			description: "TTS test",
			level: 1e6,
			cooldown: 15,
			whitelist: ["cytube"],
			exec: (usr, arg, evt) => {
				const list = MasterClient.CytubeClient.playlistData;

				if (!list) {
					evt.reply("There is no data about the playlist yet. Please wait for initialization.");
				}
				else if (list.length === 0) {
					evt.reply("The playlist is currently empty");
				}
				else {
					const song = list[0].media;
					const seconds = list.reduce((acc, cur) => acc += cur.media.seconds, 0);
					evt.reply(
						"The playlist contains " + list.length + " videos. " + 
						"Total play time ", Utils.formatTime(seconds) + ". " + 
						"Currently playing: " + song.title + " (" + song.duration + ")"
					);
				}
			}
		},

		// ---------------------------------------------------------------------------------

		// LEVEL 1 (HELPER) COMMANDS
		{ // vanish
			name: "vanish",
			description: "Vanishes itself",
			level: 1e1,
			cooldown: 5,
			whitelist: [CHAN.FORSEN],
			exec: (usr, arg, evt) => {
				evt._reply("send", "!vanish monkaS");
			}
		},
		{ // namechange
			name: "namechange",
			description: "Search for name changes for a twitch user",
			level: 1e1,
			cooldown: 15,
			exec: async (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("You have to search for a user");
					return NO_COOLDOWN_TRIGGERED;
				}

				const json = await Utils.request(url.twitchTools.nameChange(arg[0]));
				const data = JSON.parse(json)[0];
				if (data) {
					evt.reply(`Last name change for user ${data.userid}: ${data.username_old} -> ${data.username_new}. This was ${Utils.ago(new Date(data.found_at))}.`);
				}
				else {
					evt.reply("That user was either not found or never changed their name.");
				}
			}
		},
		{ // top
			name: "top",
			aliases: ["topchatters"],
			description: "Gets top 5 chatters by line count in the current channel",
			level: 10,
			cooldown: 600,
			exec: async (usr, arg, evt) => {
				if (Hogger.check(evt)) {
					return;
				}

				let limit = 1;
				const chan = evt.channel.getName().toLowerCase().replace(/#/, "");

				if (chan === "forsen") {
					limit = 10000;
				}

				const data = (await new Recordset()
					.db("chat_line")
					.select("Name, COUNT(*)")
					.from("`" + chan + "`")
					.join("User_Alias", "chat_data")
					.having("COUNT(*) > %n", limit)
					.groupBy("`" + chan + "`.User_Alias")
					.orderBy("COUNT(*) DESC")
					.limit(10)
					.fetch()
				);

				Hogger.unhog(evt);

				let reply = [];
				for (const record of data) {
					reply.push(record.Name + " (" + record["COUNT(*)"] + ")");
				}

				evt.reply("Top chatters: " + reply.join(", "));
			}
		},

		// ---------------------------------------------------------------------------------

		// LEVEL 6 (OWNER ONLY) COMMANDS
		{ // clt
			name: "clt",
			aliases: ["countlinetotal"],
			description: "Fetches the amount of data lines from ALL the log tables, including the total size",
			level: 1e6,
			cooldown: 0,
			exec: async (user, arg, evt) => {
				const data = (await new Recordset()
					.db("INFORMATION_SCHEMA")
					.select("SUM(TABLE_ROWS) AS CountLines")
					.select("SUM(DATA_LENGTH) AS CountBytes")
					.from("TABLES")
					.where("TABLE_SCHEMA = %s", "chat_line")
					.fetch()
				)[0];

				evt.reply("Currently logging " + data.CountLines + " lines in total across all channels, taking up " + Utils.round(data.CountBytes / 1024 / 1024, 3) + " MB of space.");
			}
		},
		{ // knownbot
			name: "knownbot",
			description: "Is the bot a known bot?",
			level: 1e6,
			cooldown: 0,
			exec: async (user, arg, evt) => {
				evt.reply("Am I a known/verified bot already? " + MasterClient.emoji.thinking_face);
				const data = JSON.parse(await Utils.request(url.twitch.knownBot()));
				setTimeout(() => evt.reply("Known: " + data.is_known_bot + "; verified: " + data.is_verified_bot), 1000);
			}
		},
		{ // config
			name: "config",
			description: "Changes the value of a certain configuration setting",
			level: 1e6,
			cooldown: 0,
			exec: (usr, arg, evt) => {
				const cmdDescription = arg.join(" ");
				const cmd = arg.shift();
				const type = arg.shift();
				const chan = evt.channel.getName();

				let success = null;
				let fail = null;

				switch (cmd) {
					case "level": { // level user<String> level<Number>
						const targetUser = String(type);
						const targetLevel = Number(arg.shift());

						console.log(targetUser, targetLevel);

						if (typeof targetUser !== "string" || typeof targetLevel !== "number") {
							fail = "User must be a string, level must be a number.";
						}
						else {
							MasterClient.CFG.USER_LEVELS[targetUser] = targetLevel;
							success = "User " + targetUser + " is now level " + targetLevel + ".";
						}
						break;
					}
					case "join": { // join add|remove [channel]
						const target = arg.shift() || chan;
						const index = MasterClient.CFG.JOIN_CHANNELS.indexOf(target);

						if (type === "add" && index === -1) {
							success = target + " added to auto-join list.";
							MasterClient.CFG.JOIN_CHANNELS.push(target);
						}
						else if (type === "remove" && index !== -1) {
							success = target + " removed from auto-join list.";
							MasterClient.CFG.JOIN_CHANNELS.splice(index, 1);
						}
						else {
							fail = "No need to do that (" + index + ")";
						}
						break;
					}
					case "stealth": { // stealth add|remove [channel]
						const target = arg.shift() || chan;
						const index = MasterClient.CFG.STEALTH_CHANNELS.indexOf(target);

						if (type === "add" && index === -1) {
							success = target + " added to stealth list.";
							MasterClient.CFG.STEALTH_CHANNELS.push(target);
						}
						else if (type === "remove" && index !== -1) {
							success = target + " removed from stealth list.";
							MasterClient.CFG.STEALTH_CHANNELS.splice(index, 1);
						}
						else {
							fail = "No need to do that (" + index + ")";
						}
						break;
					}
					case "logged": { // logged add|remove [channel]
						const target = arg.shift() || chan;
						const index = MasterClient.CFG.LOGGED_CHANNELS.indexOf(target);

						if (type === "add" && index === -1) {
							success = target + " added to logged list.";
							MasterClient.CFG.LOGGED_CHANNELS.push(target);
						}
						else if (type === "remove" && index !== -1) {
							success = target + " removed from logged list.";
							MasterClient.CFG.LOGGED_CHANNELS.splice(index, 1);
						}
						else {
							fail = "No need to do that (" + index + ")";
						}
						break;
					}
					case "userCD": { // userCD set:<Number>|unset [channel]
						const target = arg.shift() || chan;

						if (type.indexOf("set:") === 0) {
							const value = Number(type.split(":")[1]);
							if (isFinite(value)) {
								success = "Set " + target + " user cooldown to " + value + "ms.";
								MasterClient.CFG.CHANNEL_USER_COOLDOWNS[target] = value;
							}
							else {
								fail = "No numeric value found";
							}
						}
						else if (type === "unset") {
							success = "Unset " + target + " user cooldown. The channel will now use the default cooldowns.";
							delete MasterClient.CFG.CHANNEL_USER_COOLDOWNS[target];
						}
						break;
					}
					case "globalCD": { // globalCD set:<Number>|unset [channel]
						const target = arg.shift() || chan;

						if (type.indexOf("set:") === 0) {
							const value = Number(type.split(":")[1]);
							if (isFinite(value)) {
								success = "Set " + target + " global cooldown to " + value + "ms.";
								MasterClient.CFG.CHANNEL_GLOBAL_COOLDOWNS[target] = value;
							}
							else {
								fail = "No numeric value found";
							}
						}
						else if (type === "unset") {
							success = "Unset " + target + " global cooldown. The channel will now use the default global cooldown (" + MasterClient.CFG.DEFAULT_GLOBAL_COOLDOWN + "ms)";
							delete MasterClient.CFG.CHANNEL_GLOBAL_COOLDOWNS[target];
						}
						break;
					}
					case "defaultGCD": { // defaultGCD <Number>
						const value = Number(arg.shift());
						if (isFinite(value)) {
							success = "Set global cooldown to " + value + "ms.";
							MasterClient.CFG.DEFAULT_GLOBAL_COOLDOWN = value;
						}
						else {
							fail = "No numeric value found.";
						}
						break;
					}
					case "sr": { // sr <Boolean>
						const value = Boolean(arg.shift());
						success = "Song requests are now " + (value ? "enabled" : "disabled");
						MasterClient.CFG.SONG_REQUEUST_ENABLED = value;
						break;
					}
					case "ping": { // ping add|remove [channel]
						const target = arg.shift() || chan;
						const index = MasterClient.CFG.PING_CHANNELS.indexOf(target);

						if (type === "add" && index === -1) {
							success = target + " added to pinged channel list.";
							MasterClient.CFG.PING_CHANNELS.push(target);
						}
						else if (type === "remove" && index !== -1) {
							success = target + " removed from pinged channel list.";
							MasterClient.CFG.PING_CHANNELS.splice(index, 1);
						}
						else {
							fail = "No need to do that (" + index + ")";
						}
						break;
					}
					case "save" : {
						success = "Config saved.";
						break;
					}

					default: fail = "Unknown command";
				}

				if (success) {
					fs.writeFile("config.json", JSON.stringify(MasterClient.CFG, null, 4), (err) => {
						if (err) {
							console.log(err);
							evt.reply("Writing to the config JSON file failed!");
						}
						else {
							console.log("Config changed: " + cmdDescription);
							evt.reply(success);
						}
					});
				}
				else if (fail) {
					evt.reply(fail);
				}
				else {
					evt.reply("What?");
				}
			}
		},
		{ // protect
			name: "protect",
			description: "Adds/removes current channel to protected",
			level: 1e6,
			cooldown: 0,
			exec: (usr, arg, evt) => {
				const chan = evt.channel.getName();
				const safe = MasterClient.CFG.PAJLADIFIED_CHANNELS.indexOf(chan);

				if (!arg[0]) {
					evt.reply("This channel is " + ((safe !== -1) ? "" : "not ") + "protected");
				}
				else if (arg[0] === "true") {
					if (safe !== -1) {
						evt.reply("This channel is already protected");
					}
					else {
						MasterClient.CFG.PAJLADIFIED_CHANNELS.push(chan);
						evt.reply("This channel is now protected");
					}
				}
				else if (arg[0] === "false") {
					if (safe === -1) {
						evt.reply("This channel is already unprotected");
					}
					else {
						MasterClient.CFG.PAJLADIFIED_CHANNELS.splice(safe, 1);
						evt.reply("This channel is now unprotected");
					}
				}
				else {
					evt.reply("What?");
				}
			}
		},
		{ // ta (triviaanswer)
			name: "ta",
			description: "Attempts to answer the last trivia question",
			level: 1e6,
			whitelist: [CHAN.FORSEN],
			cooldown: 0,
			exec: (usr, arg, evt) => {
				evt._reply("send", MasterClient.latestTriviaAnswer || "?????");
			}
		},
		{ // abort
			name: "abort",
			description: "Parts the channel this command was issued in",
			level: 1e6,
			cooldown: 0,
			exec: (user, arg, evt) => {
				evt.reply("Bye guys HeyGuys");
				MasterClient.part(evt.channel.getName());
			}
		},
		{ // ban
			name: "ban",
			description: "Bans a user from the bot's commands",
			level: 1e6,
			cooldown: 0,
			exec: (user, arg, evt) => {
				if (!arg[0]) {
					evt.reply("Pick someone.");
					return;
				}

				MasterClient.CFG.USER_LEVELS[arg[0].toLowerCase()] = -1e6;
				evt.reply("User successfully banned from the bot. Bye @" + arg[0] + " >(");
			}
		},
		{ // unban
			name: "unban",
			description: "Bans a user from the bot's commands",
			level: 1e6,
			cooldown: 0,
			exec: (user, arg, evt) => {
				if (!arg[0]) {
					evt.reply("Pick someone.");
					return;
				}

				MasterClient.CFG.USER_LEVELS[arg[0].toLowerCase()] = 0;
				evt.reply("User successfully unbanned from the bot. Welcome back @" + arg[0] + " :)");
			}
		},
		{ // debug
			name: "__debug__",
			level: 1e6,
			exec: (usr, arg, evt) => {
				try {
					const reply = eval("(() => {" + arg.join(" ") + "})();");
					if (typeof reply !== "undefined") {
						evt.reply(reply);
					}
				} catch (e) {
					evt.reply(e.toString().split("\n")[0]);
				}
			}
		},
		{ // restart
			name: "restart",
			description: "Restarts the bot",
			level: 1e6,
			exec: (usr, arg, evt, disconnect) => {
				if (!disconnect) {
					MasterClient.send("#supibot", "Restarting...");
					evt.reply("I'll be back MrDestructoid");
				}
				else {
					const eventName = (disconnect === true) ? "RECONNECT" : disconnect;
					console.log("Reacting to " + eventName + " event");
				}

				MasterClient.DISCORD_LINK && MasterClient.DISCORD_LINK.send("SYSTEM", "Bot is restarting", CHAN.REFUGE);

				process.on("exit", function () {
					fs.writeFileSync("config.json", JSON.stringify(MasterClient.CFG, null, 4));

					if (process.argv.length < 3) {
						process.argv.push(MasterClient.HARD_RESET_TIMESTAMP);
					}

					Spawn(process.argv.shift(), process.argv, {
						cwd: process.cwd(),
						detached : true,
						stdio: "inherit"
					});
				});

				MasterClient.quit("BYE");
				process.exit();
			}
		},
		{ // quit
			name: "quit",
			description: "Gracefully quits the bot",
			level: 1e6,
			exec: () => {
				process.on("exit", function () {
					fs.writeFileSync("config.json", JSON.stringify(MasterClient.CFG, null, 4));
				});

				MasterClient.quit("BYE");
				process.exit();
			}
		},
		{ // reload
			name: "reload",
			description: "Reloads a specified module",
			level: 1e6,
			exec: (usr, arg, evt) => {
				if (!arg[0]) {
					evt.reply("No module specified.");
					return NO_COOLDOWN_TRIGGERED;
				}

				const target = arg.join(" ").toLowerCase();
				MasterClient.reloadModule(target, evt);
			}
		},

		// ---------------------------------------------------------------------------------

		// HELP COMMAND
		{ // help
			name: "help",
			aliases: ["commands"],
			description: "This is help's help so you can get some help for help to get help",
			cooldown: 5,
			level: 0,
			exec: (usr, arg, evt) => {
				if (!arg[0]) {
					let channel = evt.channel.getName();
					let total = COMMANDS
						.filter(i => i.level <= (MasterClient.CFG.USER_LEVELS[usr] || 0))
						.filter(i => (!i.whitelist || i.whitelist.some(j => j === channel)))
						.filter(i => (!i.blacklist || !i.blacklist.some(j => j === channel)))
						.map(i => COMMAND_PREFIX + i.name)
						.sort()
						.join(" ");

					evt.reply(total);
					return;
				}

				arg[0] = arg[0].toLowerCase();

				if (arg[0] === "me") {
					evt.reply("I wish I could help you FeelsBadMan");
					return;
				}

				let cmd = COMMANDS.find(i => i.name === arg[0] || (i.aliases && i.aliases.indexOf(arg[0]) !== -1));
				if (!cmd) {
					evt.reply("That command does not exist or you don't have sufficient rights for it! :z");
				}
				else if (!cmd.description) {
					evt.reply("That command has no description! :(");
				}
				else {
					let aliases = cmd.aliases ? (" (" + cmd.aliases.map(i => COMMAND_PREFIX + i).join(", ") + ") ") : " ";
					let cd = (cmd.cooldown) ? (", user-specific cooldown: " + cmd.cooldown + "s") : "";
					evt.reply(COMMAND_PREFIX + cmd.name + aliases + cmd.description + cd + " CoolStoryBob");
				}
			}
		}
	];

	COMMANDS.destroy = () => {};

	COMMANDS.unsetAFK = async (id) => {
		const row = await new Row("chat_data", "AFK");
		await row.load(Number(id));

		const connector = await Pool.getConnection();
		await connector.query(`
			UPDATE chat_data.AFK 
			SET Active = 0
			WHERE Active = 1 AND User_Alias = ${row.values.User_Alias}
		`);
		await connector.end();
	};

	COMMANDS.autoGazatu = async (question) => {
		const data = (await new Recordset()
			.db("data")
			.select("Answer")
			.from("Gazatu_Trivia")
			.where("Question %*like*", question)
			.where("Banned = %b", false)
			.limit(1)
			.fetch()
		)[0];

		return (data && data.Answer) || null;
	};

	return COMMANDS;
});