module.exports = (function () {
	"use strict";

	const durationRegex = /(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-zμ]*)/g;
	const unitsData = [
		{ name: "planck length", aliases: ["tp"], value: 5.391e-44 },
		{ name: "jiffy", value: 3e-24 },
		{ name: "svedberg", value: 1e-13 },
		{ name: "yoctosecond", aliases: ["yoctoseconds", "ys"], value: 1e-21 },
		{ name: "zeptosecond", aliases: ["zeptoseconds", "zs"], value: 1e-18 },
		{ name: "attosecond", aliases: ["attoseconds", "as"], value: 1e-15 },
		{ name: "femtosecond", aliases: ["femtoseconds", "fs"], value: 1e-12 },
		{ name: "picosecond", aliases: ["picoseconds", "ps"], value: 1e-9 },
		{ name: "nanosecond", aliases: ["nanoseconds", "ns"], value: 1e-6 },
		{ name: "microsecond", aliases: ["microseconds", "us", "μs"], value: 1e-3 },
		{ name: "millisecond", aliases: ["milliseconds", "ms"],value: 1 },
		{ name: "time unit", aliases: ["tu"], value: 1024e-3 },
		{ name: "second", aliases: ["seconds", "sec", "s"], value: 1e3 },
		{ name: "minute", aliases: ["minutes", "min", "m"], value: 6e4 },
		{ name: "hour", aliases: ["hours", "hr", "h"], value: 36e5 },
		{ name: "day", aliases: ["days", "d"], value: 864e5 },
		{ name: "week", aliases: ["weeks", "wk", "w"], value: 252e5 },
		{ name: "month", aliases: ["months", "b"], value: 2592e6 },
		{ name: "year", aliases: ["years", "yr", "y"], value: 31104e6 },
		{ name: "year", aliases: ["years", "yr", "y"], value: 31104e6 },
		{ name: "decade", aliases: ["decades"], value: 31104e7 },
		{ name: "century", aliases: ["centuries"], value: 31104e8 },
		{ name: "millenium", aliases: ["millenia"], value: 31104e9 },
		{ name: "megannum", aliases: ["megannums"], value: 31104e12 },
		{ name: "galactic year", aliases: ["galactic years"], value: 715392e13 }
	];

	return (str) => {
		let result = 0;
		str = str.replace(/(\d)[,](\d)/g, "$1$2");
		str.replace(durationRegex, (_, amount, unit) => {
			if (Number.isNaN(Number(amount))) {
				throw new Error("Amount must be convertible to a number");
			}
			const data = unitsData.find(i => i.name === unit || (i.aliases && i.aliases.indexOf(unit) !== -1));
			if (data === null) {
				throw new Error("Unrecognized unit " + unit);
			}
			
			result += Number(amount) * data.value
		});
		
		return result;
	};
})();