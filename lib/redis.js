const logger = require('./logger.js')('redis-handler');
const redis = require('redis');

const errorExit = (err) => {
	logger.error('redis error', err);
	process.exit(1);
    };

module.exports = {
	createClient: function(port, host, options) {
	    if (host === undefined) { host = '127.0.0.1'; }
	    if (options === undefined) { options = { db: 0 }; }
	    let handler = redis.createClient(port || 6379, host || '127.0.0.1', options);
	    handler.on('error', errorExit);
	    return handler;
	}
    };
