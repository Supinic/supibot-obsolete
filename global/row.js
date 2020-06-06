module.exports = (function (Pool) {
	"use strict";

	if (typeof Date.prototype.sqlDate !== "function") {
		throw new Error("Utils must be globally initialized first");
	}
	
	const UNSET = Symbol("nothing");

	const convert = {
		toJS: (type, value) => {
			switch (type) {
				case "boolean": return (value === 1);
				case "number": return Number(value);
				case "string": return value;
				case "date": return (Number.isNaN(Number(value))) ? new Date(value) : new Date(Number(value));
				default: throw new Error("Unsupported value type " + type);
			}
		},
		toSQL: (typeSQL, value) => {
			let typeJS = typeof value;	
			
			if (value === null) {
				return "NULL";
			}
			else if (typeJS === "boolean" && typeSQL.has("tinyint")) {
				return (value) ? "1" : "0";
			}
			else if (typeJS === "number" && typeSQL.has("int")) {
				const numericValue = Number(value);
				if (Number.isNaN(numericValue)) {
					throw new Error("Numeric value " + numericValue + " is not SQL-compliant.");
				}
				return numericValue;
			}
			else if (typeJS === "string" && (typeSQL.has("char") || typeSQL.has("text"))) {
				return "'" + value.replace(/'/g, "''") + "'";
			}
			else if (value.constructor === Date || typeJS === "string") {
				if (typeJS === "string") {
					value = new Date(value);
				}

				switch (typeSQL) {
					case "datetime": return "'" + value.sqlDateTime() + "'";
					case "date": return "'" + value.sqlDate() + "'";
					case "time": return "'" + value.sqlTime() + "'";
					case "timestamp": return "'" + value.valueOf() + "'";
					default: throw new Error("SQL <-> JS value type mismatch: " + typeSQL + " <-> " + typeJS);
				}
			}
			else if (value.constructor === Object && typeSQL === "json") {
				return JSON.stringify(value);
			}
			else {
				throw new Error("SQL <-> JS value type mismatch: " + typeSQL + " <-> " + typeJS);
			}
		}
	};
	const query = {
		load: (fullTable, ID, columns) => `SELECT ${columns.join(",")} FROM ${fullTable} WHERE ID = ${ID}`,
		update: (fullTable, ID, query) => `UPDATE ${fullTable} SET ${query.join(",")} WHERE ID = ${ID}`,
		insert: (fullTable, columns, values) => `INSERT INTO ${fullTable} (${columns.join(",")}) VALUES (${values.join(",")})`,
		delete: (fullTable, ID) => `DELETE FROM ${fullTable} WHERE ID = ${ID}`,
		definition: (db, table) => `
		SELECT COLUMN_NAME AS ColumnName, DATA_TYPE AS Type, COLUMN_TYPE AS ColumnType, IS_NULLABLE AS CanBeNull, COLUMN_DEFAULT AS DefaultValue, CHARACTER_MAXIMUM_LENGTH AS CharMax, ORDINAL_POSITION AS Position, COLUMN_KEY AS ColumnKey
		FROM information_schema.COLUMNS 
		WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${table}'
		ORDER BY ORDINAL_POSITION`
	};
	
	global.tableCache = global.tableCache || {};

	const Row = class Row {
		constructor (db, table) {
			this._definition = null;
			this._ID = null;
			this._values = {};
			this._originalValues = {};
			this._valueProxy = new Proxy(this._values, {
				get: (target, name) => {
					if (typeof target[name] === "undefined") {
						throw new Error("Column " + name + " does not exist");
					}
					return target[name];
				},
				set: (target, name, value) => {
					if (typeof target[name] === "undefined") {
						throw new Error("Column " + name + " does not exist");
					}
					target[name] = value;
					return true;
				}
			});
			
			return (async () => {
				let connector = null;

				// load definition from cache
				if (global.tableCache[db + "." + table]) {	
					this._definition = global.tableCache[db + "." + table];
				}
				// load definition from database
				else {
					connector = await Pool.getConnection();
					const data = await connector.query(query.definition(db, table));
					
					if (!data[0]) {
						throw new Error(`Table ${db}.${table} does not exist.`);
					}

					this._definition = { database: db, table: table, columns: [] };
					for (const row of data) {
						if (row.ColumnName === "ID") continue;
						
						let type = null;
						const limit = row.ColumnType.split(" ")[0].replace(/.*\((\d+)\).*/, "$1");
						if (row.Type === "tinyint" && limit === "1") {
							type = "boolean";
						}
						else if (row.Type.has("int")) {
							type = "number";
						}
						else if (row.Type.has("text") || row.Type.has("char")) {
							type = "string";
						}
						else if (row.Type.has("time") || row.Type.has("date")) {
							type = "date";
						}

						this._definition.columns.push({
							name: row.ColumnName,
							typeSQL: row.Type.split(" ")[0],
							type: type,
							position: row.Position,
							key: row.ColumnKey,
							canBeNull: (row.CanBeNull === "YES"),
							default: convert.toJS(type, row.DefaultValue)
						});
					}

					global.tableCache[this.fullTable] = this._definition;
				}

				for (const column of this._definition.columns) {
					this._values[column.name] = UNSET;
					this._originalValues[column.name] = UNSET;
				}

				connector && (await connector.end());
				return this;
			})();
		}

		async load (ID) {
			if (typeof ID !== "number") throw new Error("Type mismatch - ID must be number, but is " + typeof ID);
			
			if (this._ID) {
				this.reset();
			}
			this._ID = ID;

			const connector = await Pool.getConnection();			
			const columns = this._definition.columns.map(i => i.name);
			const data = (await connector.query(query.load(this.fullTable, this._ID, columns)))[0];

			if (!data) {
				throw new Error(`Row ID = ${this._ID} in table ${this._definition.table} does not exist.`);
			}

			for (const column in data) {
				const columnDef = this._definition.columns.find(i => i.name === column);			
				this._values[column] = this._originalValues[column] = convert.toJS(columnDef.type, data[column]);
			}
			
			await connector.end();
			return true;
		}

		async save () {
			let connector = null;
			let insertData = null;

			if (this._ID !== null) { // UPDATE
				let setColumns = [];
				for (const column of this._definition.columns) {
					if (this._originalValues[column.name] === this._values[column.name]) continue;
					setColumns.push(column.name + " = " + convert.toSQL(column.typeSQL, this._values[column.name]));
				}
				
				if (setColumns.length === 0) { // no update necessary
					return false;
				}
				
				connector = await Pool.getConnection();
				insertData = await connector.query(query.update(this.fullTable, this._ID, setColumns));
			}
			else { // INSERT
				let columns = [];
				let values = [];
				for (const column of this._definition.columns) {
					if (this._values[column.name] === UNSET) continue;

					columns.push(column.name);
					values.push(convert.toSQL(column.typeSQL, this._values[column.name]));
				}
				
				console.log(query.insert(this.fullTable, columns, values));

				connector = await Pool.getConnection();
				insertData = await connector.query(query.insert(this.fullTable, columns, values));

				this._ID = Number(insertData.insertId);
			}

			await connector.end();
			return insertData;
		}

		async delete () {
			if (this._ID !== null) {
				const connector = await Pool.getConnection();
				await connector.query(query.delete(this.fullTable, this._ID));
				await connector.end();
				
				return true;
			}
			else {
				throw new Error("In order to delete, the ID must be loaded.");
			}
		}
		
		setValues (data) {
			for (const key in data) {
				this.values[key] = data[key];
			}

			return this;
		}

		get ID () {
			return this._ID;
		}
		
		get values () {
			return this._valueProxy;
		}
		
		get fullTable () {
			if (this._definition) {
				return this._definition.database + "." + this._definition.table;
			}
			else {
				throw new Error("Row has no definition yet");
			}
		}

		get definition () {
			return this._definition || null;
		}
	};

	return Row;
});