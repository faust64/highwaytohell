const Promise = require('bluebird');
const exec = require('child_process').exec;
const request = require('request');

const execAsync = Promise.promisify(exec);
const requestAsync = Promise.promisify(request);

class CheckHealth {
    constructor (cassandra, checkinfo) {
	    return new Promise((resolve, reject) => {
		    this._log = require('./logger.js')('check-health-worker');
		    let self = this;

		    let headers = checkinfo.headers ? { 'Host': checkinfo.headers, 'User-Agent': 'HighWayToHell' } : { 'User-Agent': 'HighWayToHell' };
		    let invert = checkinfo.invert || false;
		    let match = checkinfo.match || false;
		    let target = checkinfo.target || 'http://127.0.0.1/';
		    let type = checkinfo.type || 'http';

		    let command = '';
		    if (type === 'icmp') {
			return execAsync('ping -c3 -W1 ' + target)
			    .then(() => {
				    if (process.env.DEBUG) { self._log.info('would have marked host healthy (icmp)'); }
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'false' : 'true') + ")";
				})
			    .catch((e) => {
				    if (process.env.DEBUG) { self._log.info('would have marked host unhealthy (icmp)'); }
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'true' : 'false') + ")";
				})
			    .finally(() => {
				    if (process.env.DEBUG) { self._log.info('should execute: ', command); }
				    cassandra.execute(command)
					.then(() => {
						self._log.info('executed ' + command);
						resolve(command);
					    })
					.catch((e) => {
						self._log.info('failed inserting ' + command);
						self._log.info(JSON.stringify(e));
						resolve(command);
					    });
				});
		    } else if (type === 'http' || type === 'https') {
			let options = {
				url: target,
				headers: headers,
			    };
			return requestAsync(options)
			    .then((resp) => {
				    if (match) {
					if (resp.body.indexOf(match) >= 0) {
					    if (process.env.DEBUG) { self._log.info('would have marked host healthy (http-match)'); }
					    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'false' : 'true') + ")";
					}
					if (process.env.DEBUG) { self._log.info('would have marked host unhealthy (http-match)'); self._log.info(resp.body); }
					command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'true' : 'false') + ")";
				    }
				    if (process.env.DEBUG) { self._log.info('would have marked host healthy (http)'); }
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'false' : 'true') + ")";
				})
			    .catch((e) => {
				    if (process.env.DEBUG) { self._log.info('would have marked host unhealthy (http)'); }
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'true' : 'false') + ")";
				})
			    .finally(() => {
				    if (process.env.DEBUG) { self._log.info('should execute: ', command); }
				    cassandra.execute(command)
					.then((resp) => {
						self._log.info('executed ' + command);
						resolve(command);
					    })
					.catch((e) => {
						self._log.info('failed inserting ' + command);
						self._log.info(JSON.stringify(e));
						resolve(command);
					    });
				});
		    }
		});
	}
}

exports.CheckHealth = CheckHealth;
