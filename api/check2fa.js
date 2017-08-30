const Promise = require('bluebird');
const logger = require('../lib/logger.js')('login-internals');
const redisToken = require('../lib/redisToken.js')();

module.exports = (cassandra, request, userId, code, token) => {
	let logConnection = function(clientIP, succeeded) {
		return new Promise ((resolve, reject) => {
			let queryLog = "INSERT INTO logins (uuid, clientip, time, succeeded) VALUES ('" + userId +"', '" + clientIP + "', '" + Date.now() + "', " + (succeeded === true ? 'true' : 'false') + ");"
			cassandra.execute(queryLog)
			    .then((log) => { resolve(true); })
			    .catch((e) => {
				    logger.error('failed loging 2FA ' + (succeeded === 'true' ? 'successful' : 'failed') + ' login for ' + userId);
				    logger.error(e);
				    resolve(true);
				});
		    });
	    };
	let tokenCheck = function(emailaddr, clientIP) {
		return new Promise ((resolve, reject) => {
			redisToken.getToken(emailaddr, true)
			    .then((ourToken) => {
				    if (ourToken === token) {
					redisToken.setToken('2fa:' + userId, clientIP, '36000')
					    .then((r) => { resolve(true); })
					    .catch((e) => {
						    logger.error('failed creating 2FA session token for ' + userId);
						    logger.error(e);
						    resolve(true);
						});
				    } else {
					logger.error('invalid 2FA token authenticating ' + userId);
					reject('mismatching 2FA token');
				    }
				})
			    .catch((e) => {
				    logger.error('missing 2FA token authenticating ' + userId);
				    logger.error(e);
				    reject('missing 2FA token');
				});
		    });
	    };
	let confirmBackupCode = function() {
		return new Promise ((resolve, reject) => {
			let getBackupCodes = "SELECT secret FROM backupcodes WHERE uuid = '" + userId + "'";
			cassandra.execute(getBackupCodes)
			    .then((bkp) => {
				    let postProcess = "";
				    if (bkp.rows !== undefined) {
					for (let k = 0; k < bkp.rows.length; k++) {
					    if (bkp.rows[k].secret === code) {
						postProcess = "DELETE FROM backupcodes WHERE uuid = '" + userId + "' AND secret = '" + code + "'";
						break ;
					    }
					}
				    }
				    if (postProcess !== "") {
					cassandra.execute(postProcess)
					    .then((drp) => {
						    logger.info('consumed 2FA backup code for ' + userId);
						    resolve(true);
						})
					    .catch((e) => {
						    logger.error('failed consuming 2FA backup code for ' + userId);
						    logger.error(e);
						    resolve(true);
						});
				    } else {
					logger.error('backup codes not found for ' + userId);
					reject('no backup codes');
				    }
				})
			    .catch((e) => {
				    logger.error('failed querying 2FA backup codes for ' + userId);
				    logger.error(e);
				    reject('failed querying backup codes');
				});
		    });
	    };

	return new Promise ((resolve, reject) => {
		let get2fa = "SELECT secret FROM twofa WHERE uuid = '" + userId + "'";
		let getUserData = "SELECT username, emailaddress, notifylogin, notifyfailed FROM users WHERE uuid = '" + userId + "'";
		let postProcess = "";
		let clientIP = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
		cassandra.execute(get2fa)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				cassandra.execute(getUserData)
				    .then((nresp) => {
					    if (nresp.rows !== undefined && nresp.rows[0] !== undefined && nresp.rows[0].emailaddress !== undefined) {
						let notifyLogin = nresp.rows[0].notifylogin || false;
						let notifyFailed = nresp.rows[0].notifyfailed || false;
						let validObject = { secret: resp.rows[0].secret.toString(), encoding: 'base32', token: code };
						if (require('speakeasy').totp.verify(validObject)) {
						    return tokenCheck(nresp.rows[0].emailaddress, clientIP)
							.then(() => {
								logConnection(clientIP, true);
								resolve({ email: nresp.rows[0].emailaddress, username: nresp.rows[0].username, notifyLogin: notifyLogin });
							    })
							.catch((e) => {
								logConnection(clientIP, false);
								reject({ reason: e, notifyFailed: notifyFailed });
							    });
						} else {
						    return confirmBackupCodes()
							.then(() => {
								return tokenCheck(nresp.rows[0].emailaddress, clientIP)
								    .then(() => {
									    logConnection(clientIP, true);
									    resolve({ email: nresp.rows[0].emailaddress, username: nresp.rows[0].username, notifyLogin: notifyLogin });
									})
								    .catch((e) => {
									    logConnection(clientIP, false);
									    reject({ reason: e, notifyFailed: notifyFailed });
									});
							    })
							.catch((e) => {
								logConnection(clientIP, false);
								reject({ reason: e, notifyFailed: notifyFailed });
							    });
						}
					    } else {
						logger.error('failed confirming 2FA code due to user not found --' + userId);
						logConnection(clientIP, false)
						reject({ reason: 'user not found', notifyFailed: false });
					    }
				    })
				.catch((e) => {
					logger.error('failed fetching user data for ' + userId);
					logger.error(e);
					logConnection(clientIP, false);
					reject({ reason: 'fetching user settings', notifyFailed: false });
				    });
			    } else { reject({ reason: '2FA not configured', notifyFailed: false }); }
			})
		    .catch((e) => { reject({ reason: 'failed querying cassandra', notifyFailed: false }); });
	    });
    };
