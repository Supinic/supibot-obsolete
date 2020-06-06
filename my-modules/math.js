module.exports = (function () {
	"use strict";

	const math = require("mathjs");
	const limitedEval = math.eval;
	math.import({
		print:		() => { throw new Error("print is disabled"); }, 
		map:		() => { throw new Error("map is disabled"); },
		import:		() => { throw new Error("import is disabled"); },
		createUnit: () => { throw new Error("createUnit is disabled"); },
		eval:	   	() => { throw new Error("eval is disabled"); },
		parse:	  	() => { throw new Error("parse is disabled"); },
		simplify:   () => { throw new Error("simplify is disabled"); },
		derivative: () => { throw new Error("derivative is disabled"); }
	}, { override: true });

	math.config({
		number: "BigNumber", // Default type of number: 'number' (default), 'BigNumber', or 'Fraction
		precision: 64        // Number of significant digits for BigNumbers
	});

	return {
		eval: (expression) => {
			try {
				return math.format(limitedEval(expression.replace(/°/g, "deg")), {notation:"auto", lowerExp: 0, upperExp: Infinity});

				let result = limitedEval(expression.replace(/°/g, "deg"));

				if (typeof result === "function") {
					return "Invoking functions without inputs is not allowed";
				}
				if (typeof result === "number" || typeof result === "boolean" || typeof result === "string") {
					return result;
				}
				if (result._data) {
					return result._data.toString();
				}
				if (result.entries) {
					return result.entries.join(", ");
				}
				if (result.unit || result.units) {
					return result.format({
						precision: 4,
						upperExp: 12,
						lowerExp: -6
					}).replace(/deg/g, "°");
				}

				if (Number.isNaN(result.re) || Number.isNaN(result.im)) {
					return "NaN";
				}

				let operator = " + ";
				if (Math.abs(result.re) < 2 * Number.EPSILON) result.re = 0;
				if (Math.abs(result.im) < 2 * Number.EPSILON) result.im = 0;
				if (result.im < 0) {
					result.im = Math.abs(result.im);
					operator = " - ";
				}

				if (result.im === 0 && result.re === 0) {
					return "0";
				}
				else if (result.im === 0) {
					return result.re;
				}
				else if (result.re === 0) {
					return result.im + "i";
				}
				else {
					console.log(result);
					return result.toString();
					return result.re + operator + result.im + "i";
				}
			}
			catch (e) {
				return e.toString().split("\n")[0];
			}
		}
	};
})();
