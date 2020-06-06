/**
 *	Youtube ID parser
 *	NPM module get-youtube-id by @jmorrell
 *	Converted into ES6 syntax and simplified by @supinic
 */

module.exports = (function () {
	"use strict";

	const idTestRegex = /^[^#&?]{11}$/;
	const splitRegex = /[/&?=#.\s]/g;
	const patterns = [
		/youtu\.be\/([^#&?]{11})/,  // youtu.be/<id>
		/\?v=([^#&?]{11})/,         // ?v=<id>
		/&v=([^#&?]{11})/,         // &v=<id>
		/embed\/([^#&?]{11})/,      // embed/<id>
		/\/v\/([^#&?]{11})/         // /v/<id>
	];
	
	return (url) => {
		// If any pattern matches, return the ID
		for (const pattern of patterns) {
			if (pattern.test(url)) {
				return pattern.exec(url)[1];
			}
		}

		// If that fails, break it apart by certain characters and look for the 11 character key
		const tokens = url.split(splitRegex);
		for (const token of tokens) {
			if (idTestRegex.test(token)) {
				return token;
			}
		}
		
		return null;
	};
})();