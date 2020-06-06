"use strict";
module.exports = (function (method = "GET", data) {
	const querystring = require("querystring");
    const http = require("http");

    const postData = querystring.stringify(data);
    const options = {
        host: "192.168.0.100",
        port: 3000,
        method: method,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": postData.length
        }
    };

    const req = http.request(options, res => {
        console.log("statusCode:", res.statusCode);
        console.log("headers:", res.headers);

        res.on("data", (data) => {
            console.log("Local request:", data);
        });
    });

    req.on("error", (err) => {
        console.error(err);
    });

    if (method === "POST") {
        req.write(postData);
    }
    req.end();
});
