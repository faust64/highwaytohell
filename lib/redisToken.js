const Promise = require('bluebird');
const redis = require('redis');

const client = redis.createClient(process.env.REDIS_PORT || 6379, process.env.REDIS_HOST || '127.0.0.1', { db: process.env.REDIS_DBID || '0' });

module.exports = () => {
	this.getToken = (strid, purge) => {
		return new Promise ((resolve, reject) => {
			client.get(strid, function (e, r) {
				if (e) { reject('failed reading from redis'); }
				else {
				    if (r !== null) {
					if (purge !== false) { client.del(strid); }
					resolve(r.toString());
				    } else { reject('token not found'); }
				}
			    });
		    });
	    };
	this.setToken = (strid, token, ttl) => {
		return new Promise ((resolve, reject) => {
			client.set(strid, token, function (e, r) {
				if (e) { reject('failed writing to redis'); }
				else {
				    client.expire(strid, ttl, function(de, dr) {
					    if (de) { reject('failed setting TTL to token'); }
					    else { resolve(true); }
					});
				}
			    });
		    });
	    };
	return this;
    };
