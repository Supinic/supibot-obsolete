module.exports = (function (Utils) {
	"use strict";
	
	const request = require("request");
	const baseURL = "http://:12345@192.168.0.100:8080/requests/";

	const send = (command = "", options = {}, parent) => {
		return new Promise((resolve, reject) => {
			let requestData = "";
			for (const key in options) {
				requestData += "&" + key + "=" + encodeURIComponent(options[key]);
			}

			const cmd = (command) ? ("?command=" + command) : "";
			const url = baseURL + parent + cmd + requestData;

			request(url, (err, data) => {
				if (err) reject(err);
				else {
					try {
						data = JSON.parse(data.body);
					}
					catch (e) {
						console.log("Error data", data.body);
						throw e;
					}
					resolve(data);
				}
			});
		});
	};
	const sendStatus = (command, options) => send(command, options, "status.json");
	const sendPlaylist = async (command, options) => (await send(command, options, "playlist.json")).children[0];

    let staticID = 0;

	const VLC = {
		status: () => sendStatus(),
		playlist: () => sendPlaylist(),
		next: () => sendStatus("pl_next"),
		previous: () => sendStatus("pl_previous"),

		add: async (link, user) => {
			const status = await VLC.status();
			if (status.currentplid === -1) {
				await sendStatus("in_play", {input: link});
			}
			else {
				await sendStatus("in_enqueue", {input: link});
			}

            const newID = Math.max(...(await sendPlaylist()).children.map(i => i.id)) + 1;

            VLC.requests[user] = VLC.requests[user] || [];
            VLC.requests[user].push(newID);
            return newID;
		},

		timeUntil: (id) => VLC.playlistLength(id),
		playlistLength: async (id) => {
			const status = await VLC.status();
			const playlist = await VLC.playlist();

			if (status.currentplid === -1) {
				return {
                    length: 0,
                    amount: 0
                };
			}

			if (typeof id !== "number") {
				id = playlist.children.find(i => i.current).id;
			}

            let amount = 1;
			let length = Number(status.length) - Number(status.time);
			for (const song of playlist.children) {
				if (song.id <= id) {
					continue;
				}
                amount++;
				length += Number(VLC.extraData[song.id - 1].length);
			}
			return {
                length: length,
                amount: amount
            };
		},
		currentlyPlaying: async (onlyID) => {
			const status = await VLC.status();
            if (onlyID) {
                return status.currentplid;
            }

			const playlist = await VLC.playlist();
			const playingID = status.currentplid;
			if (playingID === -1) {
				return {
                    id: -1,
					text: "No song is currently playing."
				};
			}
			else {
				const song = playlist.children.find(i => Number(i.id) === playingID);
				return {
                    id: playingID,
					text: `Currently playing "${song.name}".`,
					time: Utils.formatTime(status.time),
					length: Utils.formatTime(status.length)
				};
			}
		},

        userPendingQueue: async (user) => {
            VLC.requests[user] = VLC.requests[user] || [];
            const currentID = await VLC.currentlyPlaying(true);
            return VLC.requests[user].filter(songID => (songID >= currentID)).length;
        },

        extraData: [],
        requests: {}
    };

	return VLC;
});
