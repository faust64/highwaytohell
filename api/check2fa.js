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
				    let getUserData = "SELECT username, emailaddress, notifylogin, notifyfailed FROM users WHERE uuid = '" + userId + "'";
				    cassandra.execute(getUserData)
					.then((nresp) => {
						if (nresp.rows !== undefined && nresp.rows[0] !== undefined && nresp.rows[0].emailaddress !== undefined) {
						    let clientIP = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
						    let notifyLogin = nresp.rows[0].notifylogin || false;
						    let notifyFailed = nresp.rows[0].notifyfailed || false;
						    redisToken.getToken(nresp.rows[0].emailaddress, true)
							.then((ourToken) => {
								if (ourToken === token) {
								    let logConnection = "INSERT INTO logins (uuid, clientip, time, succeeded) VALUES ('" + userId +"', '" + clientIP + "', '" + Date.now() + "', true);"
								    redisToken.setToken('2fa:' + userId, clientIP, '36000')
									.then((r) => {
										cassandra.execute(logConnection)
										    .then((log) => {
											    resolve({ email: resp.rows[0].emailaddress, username: resp.rows[0].username, notifyLogin: notifyLogin });
											})
										    .catch((e) => {
											    logger.error('failed logging connection from ' + clientIP + ' for ' + userId);
											    resolve({ email: resp.rows[0].emailaddress, username: resp.rows[0].username, notifyLogin: notifyLogin });
											});
									    })
									.catch((de) => {
										logger.error('failed creating 2fa auth-success token, login succeeded nevertheless');
										logger.error(de);
										cassandra.execute(logConnection)
										    .then((log) => {
											    resolve({ email: resp.rows[0].emailaddress, username: resp.rows[0].username, notifyLogin: notifyLogin });
											})
										    .catch((e) => {
											    logger.error('failed logging connection from ' + clientIP + ' for ' + userId);
											    resolve({ email: resp.rows[0].emailaddress, username: resp.rows[0].username, notifyLogin: notifyLogin });
											});
									    });
								} else {
								    let logConnection = "INSERT INTO logins (uuid, clientip, time, succeeded) VALUES ('" + userId +"', '" + clientIP + "', '" + Date.now() + "', false);"
								    cassandra.execute(logConnection)
									.then((log) => { reject({ reason: 'mismatching 2FA token', notifyFailed: notifyFailed }); })
									.catch((e) => {
										logger.error('failed logging failed 2FA connection from ' + clientIP + ' for ' + userId);
										logger.error(e);
										reject({ reason: 'mismatching 2FA token', notifyFailed: notifyFailed });
									    });
								}
							    })
							.catch((e) => {
								let logConnection = "INSERT INTO logins (uuid, clientip, time, succeeded) VALUES ('" + userId +"', '" + clientIP + "', '" + Date.now() + "', false);"
								cassandra.execute(logConnection)
								    .then((log) => { reject({ reason: 'failed fetching token', notifyFailed: notifyFailed }); })
								    .catch((e) => {
									    logger.error('failed logging failed 2FA connection from ' + clientIP + ' for ' + userId);
									    logger.error(e);
									    reject({ reason: 'failed fetching token', notifyFailed });
									});
							    });
						} else { reject({ reason: 'failed retrieving user account data from cassandra', notifyFailed: false }); }
					    })
					.catch((e) => { reject({ reason: 'failed querying cassandra for user account data', notifyFailed: false }); });
				} else { reject({ reason: 'wrong 2FA code', notifyFailed: false }); }
			    } else { reject({ reason: '2FA not configured', notifyFailed: false }); }
			})
		    .catch((e) => { reject({ reason: 'failed querying cassandra', notifyFailed: false }); });
	    });
    };
