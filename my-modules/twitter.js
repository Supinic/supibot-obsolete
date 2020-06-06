module.exports = (function (Utils, Twitter) {
	"use strict";
	
    const client = new Twitter({
		consumer_key: process.env.TWITTER_CONSUMER_KEY,
		consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
		access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
		access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
    });
    
    const userParams = (user, max) => ({
		screen_name: user,
		count: max,
		exclude_replies: true,
		include_rts: false
    });
        
    return {
		lastUserTweets: (user, callback) => 
			client.get("statuses/user_timeline", userParams(user, 1), (err, resp) => {
				callback((resp && Array.isArray(resp) && resp.length > 0) ? (Utils.ago(resp[0].created_at) + ": " + resp[0].text) : ("Twitter account '" + user + "' not found, or it is protected."));
			}),
		raw: (request, url, params, callback) => client[request](url, params, callback)
    };
});