module.exports = (function () {
	"use strict";

	const Utils = require("/code/global-modules/utils.js");
	const Maria = require("mariadb");
	const Pool = Maria.createPool({
		user: process.env.MARIA_USER,
		// password: process.env.MARIA_PASSWORD,
		host: process.env.MARIA_HOST,
		connectionLimit: 100
	});

	const Recordset = require("/code/global-modules/recordset.js")(Pool);
	const Row = require("/code/global-modules/row.js")(Pool);

	class DiscordLogger {
		static async init () {
			DiscordLogger.ready = false;
			DiscordLogger.userData = new Map();
			DiscordLogger.messageBuffer = new Set();

			const data = await (new Recordset()
				.db("chat_data")
				.select("ID", "Name")
				.from("User_Alias")
				.fetch()
			);			
			for (const obj of data) {
				DiscordLogger.userData.set(obj.Name, obj.ID);
			}

			DiscordLogger.interval = setInterval(DiscordLogger.send, 60e3);
			DiscordLogger.ready = true;
		}

		static async log (messageObject) {
			const date = new Date();
			const msg = messageObject.cleanContent;
			const user = messageObject.author.username.toLowerCase();
			let userID = DiscordLogger.userData.get(user);

			// Skip twitch-linked messages
			if (user.toLowerCase() === "supibot" && msg.indexOf("🇹") === 0) {
				return;
			}

			if (!userID) {
				const row = await new Row("chat_data", "User_Alias");
				row.setValues({
					Name: user.replace(/\\/g, "\\\\"),
					Started_Using: date,
					Discord: true
				});
				await row.save();

				userID = row.ID;
				DiscordLogger.userData.set(user, row.ID);
			}

			const fixedMsg = msg.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
			DiscordLogger.messageBuffer.add(`(${userID}, "${date.sqlDateTime()}", '${fixedMsg}')`);
		}

		static async send () {
			if (DiscordLogger.messageBuffer.size !== 0) {
				const values = Array.from(DiscordLogger.messageBuffer).join(",");
				DiscordLogger.messageBuffer.clear();

				const connector = await Pool.getConnection();
				await connector.query(`INSERT INTO chat_line.discord_150782269382983689 (User_Alias, Posted, Text) VALUES ${values}`);
				connector.end();
			}
		}

		static destroy () {
			clearInterval(DiscordLogger.interval);
			DiscordLogger.interval = null;

			DiscordLogger.userData.clear();
			DiscordLogger.messageBuffer.clear();
			DiscordLogger.userData = null;
			DiscordLogger.messageBuffer = null;
		}
	}

	DiscordLogger.init();
	return DiscordLogger;
})();
