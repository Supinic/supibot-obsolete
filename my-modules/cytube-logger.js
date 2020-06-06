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

	class CytubeLogger {
		static async init () {
			CytubeLogger.ready = false;
			CytubeLogger.userData = new Map();
			CytubeLogger.videoTypeData = new Map();
			CytubeLogger.messageBuffer = new Set();

			const userData = (await new Recordset()
				.db("chat_data")
				.select("ID", "Name")
				.from("User_Alias")
				.fetch()
			);

			for (const obj of userData) {
				CytubeLogger.userData.set(obj.Name, obj.ID);
			}

			const typeData = (await new Recordset()
				.db("data")
				.select("ID", "Type")
				.from("Video_Type")
				.fetch()
			);

			for (const obj of typeData) {
				CytubeLogger.videoTypeData.set(obj.Type, obj.ID);
			}

			CytubeLogger.interval = setInterval(CytubeLogger.send, 60e3);
			CytubeLogger.ready = true;
		}

		static async logMessage (user, msg) {
			const dateStr = new Date().sqlDateTime();
			let userID = CytubeLogger.userData.get(user);
			user = user.toLowerCase();

			if (!userID) {
				const row = await new Row("chat_data", "User_Alias");
				row.setValues({
					Name: user,
					Started_Using: dateStr,
					Cytube: true
				});

				const newUserData = await row.save();
				userID = Number(newUserData.info.insertId);
				CytubeLogger.userData.set(user, newUserData.info.insertId);
			}

			const fixedMsg = (msg || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
			CytubeLogger.messageBuffer.add(`(${userID}, '${dateStr}', '${fixedMsg}')`);
		}

		static async logRequest (user, link, type, length) {
			user = user.toLowerCase();
			let userID = CytubeLogger.userData.get(user);
			const typeID =  CytubeLogger.videoTypeData.get(type);
			const date = new Date().sqlDateTime();

			if (!typeID) {
				console.log("Unupported video type", type);
				return;
			}

			if (!userID) {
				const row = await new Row("chat_data", "User_Alias");
				row.setValues({
					Name: user,
					Started_Using: date,
					Cytube: true
				});

				const newUserData = await row.save();
				userID = Number(newUserData.info.insertId);
				CytubeLogger.userData.set(user, newUserData.info.insertId);
			}


			const row = await new Row("cytube", "Video_Request");
			row.setValues({
				User: userID,
				Posted: date,
				Link: link,
				Type: typeID,
				Length: length
			});
			row.save();
		}

		static async send () {
			if (CytubeLogger.messageBuffer.size === 0) {
				return;
			}

			const values = Array.from(CytubeLogger.messageBuffer).join(",");
			CytubeLogger.messageBuffer.clear();

			const connector = await Pool.getConnection();
			await connector.query(`INSERT INTO chat_line.cytube_forsenoffline (User_Alias, Posted, Text) VALUES ${values}`);
			connector.end();
		}

		static destroy () {
			clearInterval(CytubeLogger.interval);
			CytubeLogger.interval = null;

			CytubeLogger.userData.clear();
			CytubeLogger.videoTypeData.clear();
			CytubeLogger.messageBuffer.clear();

			CytubeLogger.userData = null;
			CytubeLogger.videoTypeData = null;
			CytubeLogger.messageBuffer = null;
		}
	}

	CytubeLogger.init();
	return CytubeLogger;
})();