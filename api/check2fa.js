const Promise = require('bluebird');
const logger = require('../lib/logger.js')('login-internals');
const redisToken = require('../lib/redisToken.js')();

module.exports = (cassandra, request, userId, code, token) => {
	return new Promise ((resolve, reject) => {
		let get2fa = "SELECT secret FROM twofa WHERE uuid = '" + userId + "'";
		cassandra.execute(get2fa)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let validObject = { secret: resp.rows[0].secret.toString(), encoding: 'base32', token: code };
				if (require('speakeasy').totp.verify(validObject)) {
				    let getUserData = "SELECT username, emailaddress FROM users WHERE uuid = '" + userId + "'";
				    cassandra.execute(getUserData)
					.then((nresp) => {
						if (nresp.rows !== undefined && nresp.rows[0] !== undefined && nresp.rows[0].emailaddress !== undefined) {
						    let clientIP = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
						    redisToken.getToken(nresp.rows[0].emailaddress, true)
							.then((ourToken) => {
								if (ourToken === token) {
								    redisToken.setToken('2fa:' + userId, clientIP, '36000')
									.then((r) => {
										let logConnection = "INSERT INTO logins (uuid, clientip, time, succeeded) VALUES ('" + userId +"', '" + clientIP + "', '" + Date.now() + "', true);"
										cassandra.execute(logConnection)
										    .then((log) => {
											    resolve({ email: resp.rows[0].emailaddress, username: resp.rows[0].username });
											})
										    .catch((e) => {
											    logger.error('failed logging connection from ' + clientIP + ' for ' + userId);
											    resolve({ email: resp.rows[0].emailaddress, username: resp.rows[0].username });
											});
									    })
									.catch((de) => { reject(de); });
								} else {
								    reject('mismatching 2FA token');
								    let logConnection = "INSERT INTO logins (uuid, clientip, time, succeeded) VALUES ('" + userId +"', '" + clientIP + "', '" + Date.now() + "', false);"
								    cassandra.execute(logConnection)
									.then((log) => { reject('mismatching 2FA token'); })
									.catch((e) => {
										logger.error('failed logging failed 2FA connection from ' + clientIP + ' for ' + userId);
										reject('mismatching 2FA token');
									    });
								}
							    })
							.catch((e) => {
								let logConnection = "INSERT INTO logins (uuid, clientip, time, succeeded) VALUES ('" + userId +"', '" + clientIP + "', '" + Date.now() + "', false);"
								cassandra.execute(logConnection)
								    .then((log) => { reject('failed fetching token'); })
								    .catch((e) => {
									    logger.error('failed logging failed 2FA connection from ' + clientIP + ' for ' + userId);
									    reject('failed fetching token');
									});
							    });
						} else { reject('failed retrieving user account data from cassandra'); }
					    })
					.catch((e) => { reject('failed querying cassandra for user account data'); });
				} else { reject('wrong 2FA code'); }
			    } else { reject('2FA not configured'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
