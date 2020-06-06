(async function () {
	"use strict";

	require("/code/keys/load-keys.js")(/(maria|twitch)/i);
	const IRC = require("coffea");
	const fs = require("fs");
	const Maria = require("mariadb");
	const Spawn = require("child_process").spawn;
	const Utils = require("/code/global-modules/utils.js");

	const Pool = Maria.createPool({
		user: process.env.MARIA_USER,
		// password: process.env.MARIA_PASSWORD,
		host: process.env.MARIA_HOST,
		connectionLimit: 100
	});

	const Recordset = require("/code/global-modules/recordset.js")(Pool);
	const Row = require("/code/global-modules/row.js")(Pool);

	// Filter out messages in given channels, if the function returns true
	const channelFilter = {
		ninja: (msg = "") => msg.has(/ninja[A-Z]/g)
	};

	let config = JSON.parse(fs.readFileSync("config.json"));
	let ready = false;

	const QUERY = {
		THROUGHPUT_INSERT: (data, date) => `INSERT INTO chat_data.Message_Throughput (Date, ${Object.keys(data).join(",")}) VALUES ("${date}", ${Object.values(data).join(",")})`,
		NEW_USER: (name, date) => `INSERT INTO chat_data.User_Alias (Name, Started_Using) VALUES ('${name}', '${date}')`,
		PREPARE_MESSAGE: (id, date, text) => `(${id}, '${date}', '${text}')`,
		MESSAGE_BATCH: (table, data) => `INSERT INTO chat_line.\`${table}\` (User_Alias, Posted, Text) VALUES ${data.join(",")}`,
		THROUGHPUT_ADD_COLUMN: (table) => `ALTER TABLE chat_data.Message_Throughput ADD ${table} INT UNSIGNED NOT NULL DEFAULT '0'`,
		CREATE_LOGGING_TABLE: (table) => `
			CREATE TABLE chat_line.\`${table}\` (
				ID INT(11) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
				User_Alias INT(11),
				Text VARCHAR(500),
				Posted DATETIME,
				CONSTRAINT \`fk_user_alias_${table}\`
					FOREIGN KEY (User_Alias) REFERENCES chat_data.User_Alias (ID)
					ON DELETE CASCADE
					ON UPDATE CASCADE
			) ENGINE = INNODB`
	};

	const CHANNEL_TABLES_BUFFER = new Map();
	const USER_DATA = new Map();

	const POST_DATA = async () => {
		const row = await new Row("chat_data", "Message_Throughput");

		let total = 0;
		let queries = [];
		for (const [table, messages] of CHANNEL_TABLES_BUFFER.entries()) {
			if (messages.length === 0) {
				continue;
			}

			total += messages.length;
			row.values[table] = messages.length;

			queries.push(QUERY.MESSAGE_BATCH(table, messages));
			CHANNEL_TABLES_BUFFER.set(table, []);
		}

		row.values.Total = total;
		row.values.Timespan = new Date().sqlDateTime().replace(/:\d{2}\.\d{3}/, ""); // remove seconds and milliseconds
		row.save();

		const connector = await Pool.getConnection();
		let promises = [];
		for (const query of queries) {
			promises.push(connector.query(query));
		}

		await Promise.all(promises);
		await connector.end();

		// Something is wrong if logger logged 0 messages in 1 minute - restart itself
		if (total === 0) {
			process.on("exit", function () {
				Spawn(process.argv.shift(), process.argv, {
					cwd: process.cwd(),
					detached : true,
					stdio: "inherit"
				});
			});

			console.log("===== NO MESSAGES - RESTART =====");
			client.quit("BYE");
			setTimeout(() => process.exit(), 5000);
		}
	};

	Pool.getConnection().then(async (connector) => {
		await connector.query("SET NAMES 'utf8mb4'");

		const users = (await new Recordset()
			.db("chat_data")
			.select("ID", "Name")
			.from("User_Alias")
			.fetch()
		);
		for (const row of users) {
			USER_DATA.set(row.Name, row.ID);
		}

		const tables = await connector.query("SHOW TABLES FROM chat_line");
		for (const obj of tables) {
			CHANNEL_TABLES_BUFFER.set(obj.Tables_in_chat_line.replace(/#/, ""), []);
		}

		await connector.end();
		console.log("init successful");
		ready = true;
	});

	const client = IRC({
		host: "irc.chat.twitch.tv",
		port: 6667,
		ssl: false,
		nick: process.env.TWITCH_USERNAME,
		username: process.env.TWITCH_USERNAME,
		pass: process.env.TWITCH_OAUTH,
		throttling: 250,
		prefix: "#"
    });

	client.on("motd", () => {
		client.join(config.JOIN_CHANNELS);
		client.capReq(":twitch.tv/tags twitch.tv/commands twitch.tv/membership");
		client.send("#supibot", "Logging module: active");
    });

	client.on("command", (evt) => {
		const arg = evt.args;
		const cmd = evt.cmd;
		const user = evt.user.getNick().toLowerCase();

		if (user !== "supinic") return;

		if (cmd === "check") {
			client.send("#supibot", "Logging module: active");
		}
		else if (cmd === "flush") {
			client.send("#supibot", "Logging module: sending data");
			POST_DATA(true);
		}
		else if (cmd === "restart") {
			client.send("#supibot", "Logging module: Restarting");

			process.on("exit", function () {
				Spawn(process.argv.shift(), process.argv, {
					cwd: process.cwd(),
					detached : true,
					stdio: "inherit"
				});
			});
			client.quit("BYE");
			process.exit();
		}
		else if (cmd === "join") {
			client.join(arg[0]);
			evt.reply(".w supinic Logging module: joined " + arg[0]);
		}
		else if (cmd === "part") {
			client.part(arg[0]);
			evt.reply(".w supinic Logging module: parted " + arg[0]);
		}
		else if (cmd === "config-reload") {
			config = JSON.parse(fs.readFileSync("config.json"));
		}
	});

	client.on("data", (evt) => {
		if (evt.command !== "RECONNECT") {
			return;
		}

		process.on("exit", function () {
			Spawn(process.argv.shift(), process.argv, {
				cwd: process.cwd(),
				detached : true,
				stdio: "inherit"
			});
		});

		console.log("===== REACTING TO RECONNECT EVENT =====");
		client.quit("BYE");
		setTimeout(() => process.exit(), 5000);
	});

    client.on("message", async (evt) => {		
		if (!ready) {
			return;
		}

		const user = evt.user.getNick().toLowerCase();
		const channel = evt.channel.getName().toLowerCase().replace(/#/, "");
		let userID = USER_DATA.get(user);

		// Skip filtered messages - if the filter function returns true, skip message
		if (channelFilter[channel] && channelFilter[channel](evt.message)) {
			return;
		}

		// Skip discord-linked messages
		if (user === "supibot" && evt.message.indexOf("🇩") === 0) {
			return;
		}

		const date = new Date();
		if (!userID) {
			const row = await new Row("chat_data", "User_Alias");
			row.setValues({
				Name: user,
				Started_Using: date
			});
			await row.save();

			USER_DATA.set(user, row.ID);
			userID = row.ID;
		}

		if (!CHANNEL_TABLES_BUFFER.has(channel)) {
			const connector = await Pool.getConnection();
			await connector.query(QUERY.THROUGHPUT_ADD_COLUMN(channel));
			await connector.query(QUERY.CREATE_LOGGING_TABLE(channel));
			CHANNEL_TABLES_BUFFER.set(channel, []);
			await connector.end();
		}

		try {
			const fixedMsg = (evt.message || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
			CHANNEL_TABLES_BUFFER.get(channel).push(`(${userID}, '${date.sqlDateTime()}', '${fixedMsg}')`);
		}
		catch (e) {
			console.log(e);
			console.log(channel, CHANNEL_TABLES_BUFFER.toString());
		}
    });

	client.on("error", (err) => {
		process.on("exit", function () {
			Spawn(process.argv.shift(), process.argv, {
				cwd: process.cwd(),
				detached : true,
				stdio: "inherit"
			});
		});

		clearInterval(logInterval);
		logInterval = null;

		console.log("===== ERROR EVENT =====", err);
		client.quit("BYE");
		setTimeout(() => process.exit(), 1000);
	});

	let logInterval = setInterval(POST_DATA, 60e3); // once every 10s
})();
