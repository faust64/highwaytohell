const os = require('os');
const redis = require('redis');
const schedule = require('node-schedule');

module.exports = (role) => {
	this._channel = 'hwth-worker-' + (role || 'standalone');
	this._idString = os.hostname() + ':' + process.pid;
	this._log = require('wraplog')(role + '-advertise-neighbors');
	this._neighbors = [];
	let self = this;

	this._publisher = redis.createClient(process.env.REDIS_PORT || 6379, process.env.REDIS_HOST || '127.0.0.1', { db: process.env.REDIS_DBID || '0' });
	this._subscriber = redis.createClient(process.env.REDIS_PORT || 6379, process.env.REDIS_HOST || '127.0.0.1', { db: process.env.REDIS_DBID || '0' });
	    //FIXME
	//this._publisher.on('error', ...);
	//this._subscriber.on('error', ...);

	this._subscriber.on('message', (chan, msg) => {
		if (process.env.DEBUG) { self._log.info(self._idString + ' received message from ' + msg); }
		if (self._neighbors[msg] === undefined) {
		    self._neighbors[msg] = 2;
		} else {
		    self._neighbors[msg]++;
		}
	    });
	this._subscriber.subscribe(this._channel);

	this._advertiseNeighbors = schedule.scheduleJob('*/10 * * * * *', () => {
		self._publisher.publish(self._channel, self._idString);
		if (process.env.DEBUG) { self._log.info('advertised neighbors from ' + self._idString); }
	    });

	this._cleanupNeighbors = schedule.scheduleJob('*/10 * * * * *', () => {
		if (self._neighbors[self._idString] !== undefined) {
		    for (let key in self._neighbors) {
			if (self._neighbors[key] > 0) {
			    self._neighbors[key]--;
			    if (process.env.DEBUG) { self._log.info(self._idString + ' knows of ' + key + ' with score ' + self._neighbors[key]); }
			} else {
			    delete self._neighbors[key];
			    if (process.env.DEBUG) { self._log.info(self._idString + ' removing ' + key + ' for no having checked in lately'); }
			}
		    }
		}
	    });

	return {
		getId: function() {
			return self._idString;
		    },
		getNeighbors: function() {
			return self._neighbors;
		    },
		getOrderedNeighbors: function() {
			let ret = [];
			Object.keys(self._neighbors)
			    .sort().forEach((i, j) => {
				    ret.push(i);
				});
			return ret;
		    },
		isElectedMaster: function() {
			let ret = [];
			Object.keys(self._neighbors)
			    .sort().forEach((i, j) => {
				    ret.push(i);
				});
			return ((ret[0] == self._idString));
		    },
		cancel: function() {
			self._advertiseNeighbors.cancel();
			self._cleanupNeighbors.cancel();
		    }
	    }
    }
