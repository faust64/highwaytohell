const Promise = require('bluebird');
const crypto = require('crypto');
const redisToken = require('../lib/redisToken')();

module.exports = (userId) => {
	return new Promise ((resolve, reject) => {
		crypto.randomBytes(48, function(e, buf) {
			if (e) { reject('failed generating token'); }
			else {
			    let token = buf.toString('hex');
			    redisToken.setToken(userId, token, '300')
				.then((r) => { resolve(token); })
				.catch((de) => { reject(de); });
			}
		    });
	    });
    };
