// singleton
module.exports = (function () {
	"use strict";

	const delim = "-";
	const keyify = (evt) => [evt.cmd, evt.channel.getName(), evt.user.getNick()].map(i => i.toLowerCase()).join(delim);

	class Hogger {
		constructor () {
			this.progressData = new Set();
		}

		check (evt) {
			const key = keyify(evt);
			if (this.progressData.has(key)) {
				const [, chan, usr] = key.split(delim);
				if (usr === evt.user.getNick()) {
					evt.reply("You are hogging the command 4Head");
				}
				else if (chan === evt.channel.getName()) {
					evt.reply(usr + " is hogging the command 4Head");
				}
				else {
					evt.reply("Another channel is hogging the command 4Head");
				}
				return true;
			}

			this.hog(evt);
			return false;
		}

		hog (evt) {
			this.progressData.add(keyify(evt));
		}

		unhog (evt) {
			this.progressData.delete(keyify(evt));
		}

		clear () {
			this.progressData.clear();
		}
	}

	return new Hogger();
})();