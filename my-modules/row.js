module.exports = (function (DB) {
	"use strict";

	if (process.argv[2] === "debug") {
		const Maria = require("mariasql");
		DB = new Maria({
			user: "root",
			// password: process.env.MARIA_PASSWORD,
			host: "localhost"
		});
	}

	global.tableCache = global.tableCache || {};

	class Row {
		constructor (db, table) {
			this.definition = null;
			this.loaded = false;
			this.ID = null;

			if (global.tableCache[table]) {	
				// load definition from cache
				this.loaded = false;
			}
			else {
				const defSQL = `
					SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
					FROM information_schema.COLUMNS 
					WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${table}'`;

				DB.query(defSQL, (err, resp) => {
					this.loaded = true;
					console.log(err, resp);

					// iterate over result
					// set cache
					// set self definition
				});
			}
		}

		load (ID) {
			this.ID = ID;
		}

		save () {
			if (this.ID !== null) {
				// UPDATE
			}
			else {
				// INSERT
			}
		}

		delete () {
			if (this.ID !== null) {
				// DELETE
			}
			else {
				// throw error - cannot delete
			}
		}
	}

	return Row;
});