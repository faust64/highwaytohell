const Promise = require('bluebird');
const cst = require('./cassandra.js');
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
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'false' : 'true') + ")";
				})
			    .catch((e) => {
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'true' : 'false') + ")";
				})
			    .finally(() => {
				    if (process.env.DEBUG) { self._log.info('should execute: ', command); }
				    cassandra.execute(command, [], cst.writeConsistency())
					.then(() => {
						if (process.env.DEBUG) { self._log.info('executed ' + command); }
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
					    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'false' : 'true') + ")";
					} else {
					    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'true' : 'false') + ")";
					}
				    }
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'false' : 'true') + ")";
				})
			    .catch((e) => {
				    command = "INSERT INTO checkhistory (uuid, when, value) VALUES ('" + checkinfo.uuid + "', '" + Date.now() + "', " + (invert ? 'true' : 'false') + ")";
				})
			    .finally(() => {
				    cassandra.execute(command, [], cst.writeConsistency())
					.then((resp) => {
						if (process.env.DEBUG) { self._log.info('executed ' + command); }
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
