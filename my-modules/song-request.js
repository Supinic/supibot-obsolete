module.exports = (function () {
	const request = require("request");
	const baseURL = "http://:supinic@192.168.0.100:8080/requests/";

	const sendStatus = (command, options = {}) => {
		return new Promise((resolve, reject) => {
			let requestData = "";
			for (const key in options) {
				requestData += "&" + key + "=" + encodeURIComponent(options[key]);
			}

			const url = baseURL + "status.json?command=" + command + requestData;
			console.log(url);

			request(url, (err, data) => {
				if (err) reject(err);
				else resolve(data);
			});
		});
	};

	return {
		addAndPlay: (link) => sendStatus("in_play", {input: link}),
		add: (link) => sendStatus("in_enqueue", {input: link}),
		next: () => sendStatus("pl_next"),
		previous: () => sendStatus("pl_previous")
	};
})();
