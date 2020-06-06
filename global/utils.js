module.exports = (function () {
	"use strict";

	const request = require("request");
	const YoutubeFind = require("youtube-search");
	const YoutubeParser = require("./youtube-id-parser.js");

	const BANNED_WORD_FILLER = "\u206D";
	const BANNED_WORD_FILLER_REGEX = /[\u180e\ufeff\u2000-\u200d\u206D]/g;
	const BANNED_WORDS = ["fag", "gook", "kanker", "nigger", "tranny", "shemale"].map(i => new RegExp(i, "gi"));
	const YOUTUBE_DURATION_REGEX = /PT((\d+)H)?((\d+)M)?((\d+)S)?/g;
	
	const WEEB_REGEX = /kanna|ayaya|forsenpuke|naro|cir|forsenlewd/i;
	const CYRILLIC_REGEX = /[а-я]/i;
	const GREEK_REGEX = /[α-ωΑ-Ω\s]/i;
	const TURKO_ARABIC_REGEX = /[\u0600-\u06FFĞ]/i;
	const CJKT_REGEX = /[\u0E01-\u0E5B]|[⺀-\u2efe\u3000-〾㇀-\u31ee㈀-㋾㌀-㏾㐀-\u4dbe一-\u9ffe豈-\ufafe︰-﹎]|[\ud840-\ud868\ud86a-\ud86c][\udc00-\udfff]|\ud869[\udc00-\udede\udf00-\udfff]|\ud86d[\udc00-\udf3e\udf40-\udfff]|\ud86e[\udc00-\udc1e]|\ud87e[\udc00-\ude1e]/i;
	const BLACK_PEOPLE_REGEX = /nig|kkk|reggin|nik|trihard|black/i;
	const FOOTBALL_REGEX = /soccer|football/i;
	const BRAILLE_REGEX = /\u2802-\u28ff/;

	const url = {
		youtubeExtra: (key, id) => `https://www.googleapis.com/youtube/v3/videos?part=contentDetails%2Cstatistics&key=${key}&id=${id}`
	};

	const banphrases = [
		{ ban: "facebook", resp: "Bace Fook 📖" },
		{ ban: "summer", resp: "FeelsGoodMan 🌞 🚗" },
		{ ban: "sleeper", resp: "💤" },
		{ ban: "8766", resp: "☄ 👈 cmonBruh" },
		{ ban: BLACK_PEOPLE_REGEX, resp: "cmonBruh chu sayin?" },
		{ ban: FOOTBALL_REGEX, resp: "⚽" },
		{ ban: "shut", resp: " - telling others to shut up D: ?" },
		{ ban: WEEB_REGEX, resp: " - weeb stuff pepeL" },
		{ ban: CYRILLIC_REGEX, resp: " - cyrillic characters KKomrade" },
		{ ban: TURKO_ARABIC_REGEX, resp: " - arabic characters ANELE" },
		{ ban: CJKT_REGEX, resp: " - asian characters MingLee" },
		{ ban: GREEK_REGEX, resp: " - greek characters 🇬🇷" },
		{ ban: "▀", resp: "- Unicode Character UPPER HALF BLOCK (U+2580)" },
		{ ban: "blood", resp: "💉" },
		{ ban: "weird", resp: "Pepega FELS WEIRD FOR SAN Pepega" }
	];

	const banphraseEmote = (reason, chan) => {
		const msg = reason.replace(/\s/g, "").toLowerCase();
		for (const {ban, resp} of banphrases) {
			const checker = (ban instanceof RegExp) ? ban : new RegExp(ban, "g");
			if (checker.test(msg)) {
				return resp;
			}
		}

		if (chan === "#forsen") {
			return ":z";
		}
		else {
			return "FeelsWeirdMan";
		}
	};

    const Utils = {
		zeroWidthRegex: BANNED_WORD_FILLER_REGEX,

		sum: (accumulator, current) => current += accumulator,

		future: (date) => {
			let future = Math.abs(Date.now() - new Date(date));
			if (future < 1e3) return "in less than a second";
			if (future < 6e4)  return "in " + Utils.round(future / 1000, 2) + "s";
			if (future < 36e5) return "in " + Math.trunc(future / 6e4) + "m";

			if (future < 864e5) {
				let hours = Math.trunc(future / 36e5);
				let minutes = Math.trunc(future / 6e4) % 60;
				return "in " + hours + "h, " + minutes + "m";
			}
			else if (future < 31536e6) {
				let days = Math.trunc(future / 864e5);
				let hours = Math.trunc(future / 36e5) % 24;
				return "in " + days + "d, " + hours + "h";
			}
			else {
				let years = Math.trunc(future / 31536e6);
				let days = Math.trunc(future / 864e5) % 365;
				return "in " + years + "y, " + days + "d";
			}
		},

		ago: (date) => {
			let ago = Math.abs(Date.now() - new Date(date));
			if (ago < 1e3) return "less than a second ago";
			if (ago < 6e4)  return Utils.round(ago / 1000, 2) + "s ago";
			if (ago < 36e5) return Math.trunc(ago / 6e4) + "m ago";

			if (ago < 864e5) {
				let hours = Math.trunc(ago / 36e5);
				let minutes = Math.trunc(ago / 6e4) % 60;
				return hours + "h, " + minutes + "m ago";
			}
			else if (ago < 31536e6) {
				let days = Math.trunc(ago / 864e5);
				let hours = Math.trunc(ago / 36e5) % 24;
				return days + "d, " + hours + "h ago";
			}
			else {
				let years = Math.trunc(ago / 31536e6);
				let days = Math.trunc(ago / 864e5) % 365;
				return years + "y, " + days + "d ago";
			}
		},

		toDictionary: (rawMessage, orderBy = "") => {
			const arr = rawMessage.replace(/\s+/g, " ").trim().split(" ");
			let dictionary = new Map(arr.map(i => [i, 0]));
			arr.forEach(i => dictionary.set(i, dictionary.get(i) + 1));

			if (orderBy.toLowerCase() === "desc") {
				dictionary = new Map([...dictionary.entries()].sort((a, b) => b[1] - a[1]));
			}
			else if (orderBy.toLowerCase() === "asc") {
				dictionary = new Map([...dictionary.entries()].sort((a, b) => a[1] - b[1]));
			}

			return dictionary;
		},

		round: (num, places = 0) => (Math.round(num * (10 ** places))) / (10 ** places),

		removeHTML: (string) => string.replace(/<(.*?)>/g, ""),

		safeWrap: (string, length) => {
			for (let regex of BANNED_WORDS) {
				string = string.replace(regex, word => word[0] + BANNED_WORD_FILLER + word.slice(1));
			}

			if (string.length < length) return string.replace(/\r?\n/g, " ");
			else return string.replace(/\r?\n/g, " ").substr(0, length - 3) + "...";
		},

		rsPriceWrap: (price) => {
			if (price >= 1e8) return Math.trunc(price / 1e6) + "M";
			if (price >= 1e6) return Math.trunc(price / 1e3) + "k";
			else return price;
		},

		rand: (min, max) => Math.floor(Math.random() * (max - min) + min),

		randArray: (arr) => arr[Utils.rand(0, arr.length)],

		fetchDBData: (Client, query) => new Promise((resolve, reject) => {
			Client.query(query, (err, resp) => {
				if (err) reject(err);
				else resolve(resp);
			});
		}),

		formatTime: (seconds = 0, videoStyle = false) => {
			seconds = Number(seconds);
			let stuff = [];
			
			if (videoStyle) {
				if (seconds >= 3600) {
					const hr = Math.floor(seconds / 3600);
					stuff.push(hr);
					seconds -= (hr * 3600);
				}
				const min = Math.floor(seconds / 60);
				stuff.push(min);
				seconds -= (min * 60);
				stuff.push(Utils.zf(seconds, 2));

				return stuff.join(":");
			}
			else {
				if (seconds >= 3600) {
					const hr = Math.floor(seconds / 3600);
					stuff.push(hr + " hr");
					seconds -= (hr * 3600);
				}
				if (seconds >= 60) {
					const min = Math.floor(seconds / 60);
					stuff.push(min + " min");
					seconds -= (min * 60);
				}
				if (seconds >= 0 || stuff.length === 0) {
					stuff.push(seconds + " sec");
				}
				return stuff.join(", ");
			}
		},

		argsToFixedURL: (array, character = "+") => array.map(i => encodeURIComponent(i)).join(character),

		removeAccents: (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),

		parseYoutubeID: (url) => YoutubeParser(url),

		request: (url) => new Promise((resolve, reject) => { 
			request(url, (err, resp) => {
				if (err) reject(err);
				else resolve(resp.body);
			});
		}),

		fetchYoutubeVideo: async (str, key, strict) => {
			let videoID = Utils.parseYoutubeID(str);

			if (strict) {
				return null;
			}
			else {
				videoID = str;
			}

			const dataYT = (await YoutubeFind(videoID, {
				type: "video",
				maxResults: 1,
				key: key
			})).results[0];

			if (!dataYT) {
				return null;
			}

			let dataExtra = JSON.parse(await Utils.request(url.youtubeExtra(key, dataYT.id)));
			dataExtra = dataExtra.items[0] || {};

			return {
				id: videoID,
				author: dataYT.channelTitle,
				name: dataYT.title,
				link: dataYT.link,
				length: Utils.ytDurationToNumber(dataExtra.contentDetails.duration),
				views: Number(dataExtra.statistics.viewCount),
				comments: Number(dataExtra.statistics.commentCount),
				likes: Number(dataExtra.statistics.likeCount),
				dislikes: Number(dataExtra.statistics.dislikeCount),
				posted: new Date(dataYT.publishedAt)
			};
		},

		ytDurationToNumber: ((str) =>
			str.replace(YOUTUBE_DURATION_REGEX, (a, b, hr, c, min, d, sec) => (+hr * 3600 || 0) + (+min * 60 || 0) + (+sec || 0))
		),

		zf: (number, padding) => ("0".repeat(padding) + number).slice(-padding),

		globalCheck: (msg, banphrases) => {
			const fixedMsg = Utils.removeAccents(msg.toLowerCase()).replace(BANNED_WORD_FILLER_REGEX, "");
			return !!banphrases.some(i => fixedMsg.has(i));
		},
		
		pajladaCheck: (msg, chan, config) => new Promise((resolve, reject) => {
			msg = msg.replace(BANNED_WORD_FILLER_REGEX, "")
				.replace(/-/g, "");

			if (chan === "#forsen") {
				if (msg.indexOf("\u{0001}") !== -1) {
					resolve({
						phrase: "Control character",
						reply: "Control characters? FeelsWeirdMan"
					});
					return;
				}

				const bigEmoteCount = (msg.match(/(NaM)|(FishMoley)|(YetiZ)|(TaxiBro)/g) || []).length;
				if (bigEmoteCount >= 13) {
					resolve({
						phrase: "Too many big emotes",
						reply: "That message is too big NaM"
					});
					return;
				}

				if (BRAILLE_REGEX.test(msg)) {
					resolve({
						phrase: "Braille art",
						reply: "pepeL braille art"
					});
					return;
				}

				if (msg.length >= 50) {
					const dict = Array.from(Utils.toDictionary(msg, "desc"));
					if (dict.length > 1 && dict[0][1] > 4 && dict[0][1] === dict[1][1]) {
						resolve({
							phrase: "Repeated messages",
							reply: "If I said that I would get timed out - repeated messages ppHop"
						});
					}
				}
			}

			const url = "https://" + (config.BANPHRASE_API_URL[chan] || "forsen.tv") + "/api/v1/banphrases/test";
			request(
				{
					method: "POST",
					url: url,
					body: "message=" + msg
						.replace(BANNED_WORD_FILLER_REGEX, "")
						.replace(/\s/g, "+")
						.replace(/&/g, "%26")
						.replace(/=/g, "%3D")
						.replace(/\?/g, "%3F"),
					headers: {
						"Content-Type": "application/x-www-form-urlencoded"
					},
					timeout: 5000
				},
				(err, resp, body) => {
					if (err) {
						reject(err);
					}
					else {
						let data = null;
						try {
							data = JSON.parse(body);
						}
						catch (e) {
							console.log("PAJLADA API FAIL", body);
							reject(e);
							return;
						}

						if (data.banned) {
							resolve({
								phrase: data.banphrase_data.phrase,
								reply: "If I said that I would get timed out " + banphraseEmote(data.banphrase_data.phrase, chan),
								emote: banphraseEmote(data.banphrase_data.phrase)
							});
						}
						else {
							resolve(false);
						}
					}
				}
			);
		})
    };

	const zf2 = (str) => Utils.zf(str, 2);
	const zf3 = (str) => Utils.zf(str, 3);
	Date.prototype.format = function (formatString) {
		const year = this.getFullYear(),
			month = this.getMonth() + 1,
			day = this.getDate(),
			hours = this.getHours(),
			minutes = this.getMinutes(),
			seconds = this.getSeconds(),
			milli = this.getMilliseconds();

		let value = "";
		for (const char of formatString) {
			switch (char) {
				case "d": value += zf2(day); break;
				case "j": value += day; break;
				case "m": value += zf2(month); break;
				case "n": value += month; break;
				case "Y": value += year; break;

				case "G": value += hours; break;
				case "H": value += zf2(hours); break;
				case "i": value += zf2(minutes); break;
				case "s": value += zf2(seconds); break;
				case "v": value += zf3(milli); break; 

				default: value += char;
			}
		}
		return value;
	};

	Date.prototype.simpleDate = function () { return this.format("j.n.Y"); };
	Date.prototype.simpleDateTime = function () { return this.format("j.n.Y H:i:s"); };
	Date.prototype.fullDateTime = function () { return this.format("j.n.Y H:i:s.v"); };
	Date.prototype.sqlDate = function () { return this.format("Y-m-d"); };
	Date.prototype.sqlTime = function () { return this.format("H:i:s.v"); };
	Date.prototype.sqlDateTime = function () { return this.format("Y-m-d H:i:s.v"); };

	Date.prototype.toUTC = function ()  {
		this.setMinutes(this.getMinutes() + this.getTimezoneOffset());
		return this;
	};

	Date.prototype.setTimezoneOffset = function (offset) {
		offset = Number(offset);
		if (Number.isNaN(offset)) throw new Error("Invalid offset");
		this.setHours(this.getUTCHours() + offset);
		return this;
	};

	Array.prototype.last = function () {
		if (this.length === 0) {
			throw new RangeError("Array is empty, there is no last element");
		}
		return this[this.length - 1];
	};

	Array.prototype.has = function (target) {
		return this.indexOf(target) !== -1;
	};

	String.prototype.has = function (target) {
		if (target instanceof RegExp) {
			return target.test(this);
		}
		return (this.indexOf(target) !== -1);
	};

	process.on("uncaughtException", err => {
		console.log(new Date().fullDateTime() + " uncaughtException: ", err.message);
		console.log(err.stack);

		require("child_process").spawn(process.argv.shift(), process.argv, {
			cwd: process.cwd(),
			detached : true,
			stdio: "inherit"
		});

		process.exit(1);
	});

	return Utils;
})();
