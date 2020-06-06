module.exports = (function (DB) {
	"use strict";

	if (typeof Date.prototype.simpleDateTime !== "function") {
		throw new Error("Utils must be globally initialized first");
	}

	const replaceRegex = /%(b|p|n|s|t|\*?like\*?)/g;
	const replacements = {
		"b": (param) => {
			if (typeof param !== "boolean") throw new Error("Mismatched type: Expected boolean, received " + typeof param);
			return (param ? "1" : "0");
		},
		"d": (param) => {
			if (!(param instanceof Date)) throw new Error("Mismatched type: Expected Date, received " + typeof param);
			return param.simpleDateTime().split(" ")[0];
		},
		"n": (param) => {
			if (typeof param !== "number") throw new Error("Mismatched type: Expected number, received " + typeof param);
			return param;
		},
		"s": (param) => {
			if (typeof param !== "string") throw new Error("Mismatched type: Expected string, received " + typeof param);
			return "'" + param.replace(/'/g, "''") + "'";
		},
		"t": (param) => {
			if (!(param instanceof Date)) throw new Error("Mismatched type: Expected Date, received " + typeof param);
			return param.simpleDateTime();
		},
		"*like*": (param) => {
			if (typeof param !== "string") throw new Error("Mismatched type: Expected string, received " + typeof param);
			return " LIKE '%" + param.replace(/'/g, "''") + "%'";
		}
	};

	class Recordset {
		constructor () {
			this._limit = null;
			this._offset = null;
			this._defaultDB = null;
			this._select = [];
			this._from = [];
			this._where = [];
			this._having = [];
			this._orderBy = [];
			this._groupBy = [];
			this._join = [];
			this._raw = null;
		}

		db (database) {
			this._defaultDB = database;
			return this;
		}

		limit (number) {
			this._limit = Number(number);
			return this;
		}

		offset (number) {
			this._offset = Number(number);
			return this;
		}

		select (...args) {
			this._select = this._select.concat(args);
			return this;
		}

		from (...args) {
			this._from = this._from.concat(args);
			return this;
		}

		groupBy (...args) {
			this._groupBy = this._groupBy.concat(args);
			return this;
		}

		orderBy (...args) {
			this._orderBy = this._orderBy.concat(args);
			return this;
		}

		where (...args) {
			let options = {};
			if (args[0] && args[0].constructor === Object) {
				options = args[0];
				args.shift();
			}

			if (typeof options.condition !== "undefined" && !options.condition) {
				return this;
			}

			let format = "";
			if (typeof args[0] === "string") {
				format = args.shift();
			}

			let index = 0;
			format = format.replace(replaceRegex, (fullMatch, param) => {
				return replacements[param](args[index++]);
			});

			this._where = this._where.concat(format);
			return this;
		}

		having (format, ...rest) {
			let index = 0;
			format = format.replace(replaceRegex, (fullMatch, param) => {
				return replacements[param](rest[index++]);
			});

			this._having = this._having.concat(format);
			return this;
		}

		join (param, db = "") {
			if (typeof param === "string") {
				const dot = (db) ? (db + ".`" + param + "`") : ("`" + param + "`");
				this._join.push("JOIN " + dot + " ON " + this._from[0] + "." + param + " = " + dot + ".ID");
			}
			else if (param && param.constructor === Object) {
				if (typeof param.raw === "string") {
					this._join.push("JOIN " + param.raw);
				}
				else {
					throw new Error("Not yet implemented");
				}
			}

			return this;
		}

		raw (format, ...rest) {
			let index = 0;
			format = format.replace(/(%[bdnst])/g, (fullMatch, param) => {
				return replacements[param](rest[index++]);
			});

			this._raw = format;
			return this;
		}

		toSQL () {
			if (this._raw) {
				return this._raw;
			}

			let sql = [];
			if (this._select.length === 0) {
				throw new Error("No SELECT in Recordset");
			}

			sql.push("SELECT " + this._select.join(", "));
			
			(this._from.length !== 0) && sql.push("FROM " + this._from.map(i => [this._defaultDB, i].filter(Boolean).join(".")).join(", "));
			(this._join.length !== 0) && sql.push(this._join.join(" "));
			(this._where.length !== 0) && sql.push("WHERE " + this._where.join(" AND "));
			(this._groupBy.length !== 0) && sql.push("GROUP BY " + this._groupBy.join(", "));
			(this._having.length !== 0) && sql.push("HAVING " + this._having.join(", "));
			(this._orderBy.length !== 0) && sql.push("ORDER BY " + this._orderBy.join(", "));
			(this._limit !== null) && sql.push("LIMIT " + this._limit);
			(this._offset !== null) && sql.push("OFFSET " + this._offset);

			return sql.join(" ");
		}

		async fetch () {
			let sql = null;
			try {
				sql = this.toSQL();
				const data = await new Promise((resolve, reject) => {
					DB.query(sql, (err, resp) => {
						if (err) reject(err);
						else resolve(resp);
					});
				});

				let result = [];
				for (const record of data) {
					result.push(record);
				}

				result.count = data.info.numRows;
				return result;
			}
			catch (err) {
				console.log("Query failed", sql, err);
				return null;
			}
		}
	}

	return Recordset;
});