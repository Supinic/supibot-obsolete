module.exports = (function (client) {
	"use strict";

	const BIG_EMOTES_REGEX = /AngelThump|NaM|FishMoley|YetiZ|AndKnuckles|TaxiBro/g;
	const ZERO_WIDTH_REGEX = /[\u180e\ufeff\u2000-\u200d]./;
	const EMOJI_REGEX = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/ug;
	const CHANNEL = "#supinic";
	const PLANS = {
		1000: "$5",
		2000: "$10",
		3000: "$25",
		Prime: "Prime"
	};

	const send = (...args) => client.send(CHANNEL, args.join(" "));
	const numberSuffix = (num) => (num === 1) ? "st" : (num === 2) ? "nd" : (num === 3) ? "rd" : "st";
	const objectify = (data) => {
		let obj = {};

		data.split(";").forEach(record => {
			const [key, value] = record.split("=");
			obj[key.replace(/-/g, "_")] = value;
		});

		return obj;
	};
	const timeout = (user, length, reason) => send(`.timeout ${user} ${length} ${reason}`);

	return {
		data: (message, data, evt) => {
			let string = "";
			data = objectify(data);

			if (message === "USERNOTICE") {
				const user = data.display_name;
				const plan = PLANS[data.msg_param_sub_plan];

				if (data.msg_id === "sub") {
					if (plan === PLANS.Prime) {
						string = "PogChamp " + user + " just smashed the subscribe button with Twitch Prime!";
					}
					else {
						string = "NO WAY PagChomp " + user + " actually subscribed with " + plan + " worth of real money!";
					}
				}
				else if (data.msg_id === "resub") {
					const times = Number(data.msg_param_months);
					if (plan === PLANS.Prime) {
						string = "PogChamp Clap " + user + " managed to SMASH the subscribe button " + times + " times in a row!";
					}
					else {
						string = "NO WAY PagChomp Clap " + user + " actually resubscribed for " + times + " months with a " + plan + " sub!";
					}
				}
				else if (data.msg_id === "subgift") {
					const times = Number(data.msg_param_months);
					string = "🎁 Clap " + user + " just gifted a " + plan + " sub to " + data.msg_param_recipient_display_name;

					if (times > 0) {
						string += " for their " + times + numberSuffix(times) + " month in a row";
					}

					string += "!";
				}

				send(string);
			}
			else if (message === "HOSTTARGET") {
				const params = evt.trailing.split(" ");
				if (params[0] === "-") {
					return;
				}

				let string = evt.params.substr(1) + " is now hosting us for " + params[1] + " viewers";
				if (Number(params[1]) === 0) {
					string += ". Thanks for the gesture Kapp";
				}
				else {
					string += "! PagChomp";
				}

				client.send(string);
			}
		},

		message: (user, message, userBanned, isGlobalCD) => {
			const bigCount = (message.match(BIG_EMOTES_REGEX) || []).length;
			const emojiCount = (message.match(EMOJI_REGEX) || []).length;

			if (message.indexOf("!vanish") === 0) {
				timeout(user, 1, "Vanish monkaS");
			}
			// else if (message.toLowerCase().has("weird")) {
			// 	timeout(user, 1, "forsenE not affected forsenE");
			// }
			else if (message.length >= 400) {
				const overLimit = message.length - 400;
				timeout(user, overLimit, "Message too long (" + overLimit + " characters over limit)");
			}
			else if (bigCount >= 4) {
				timeout(user, 30, "Overusing big emotes (" + bigCount + "x)");
			}
			else if (emojiCount >= 25) {
				timeout(user, 30, "Too many emojis (" + emojiCount + " x)");
			}
			else if (ZERO_WIDTH_REGEX.test(message)) {
				timeout(user, 120, "Trying to fuck with the system");
			}
		}
	};
});
