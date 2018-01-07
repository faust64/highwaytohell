const Promise = require('bluebird');
const cst = require('./cassandra.js');
const logger = require('wraplog')('notify-worker');
const request = require('request');
const requestAsync = Promise.promisify(request);
const sendMail = require('./sendMail.js');
const sendSMS = require('./sendSMS.js');

module.exports = (cassandra, notify) => {
	return new Promise((resolve, reject) => {
		let watchFor = 1 + ((notify.notifydownafter > notify.notifyupafter) ? notify.notifydownafter : notify.notifyupafter);
		let lookupHistory = "SELECT * FROM checkhistory WHERE uuid = '" + notify.idcheck + "' ORDER BY when DESC limit " + watchFor;
		cassandra.execute(lookupHistory, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined && resp.rows[0].when !== undefined) {
				let limit = (resp.rows[0].value === true) ? notify.notifyupafter : notify.notifydownafter;
				let count = 1;
				for (; count < resp.rows.length; count++) {
				    if (resp.rows[0].value !== resp.rows[count].value) { break; }
				}
				if (count === limit) {
				    logger.info('status changed ' + count + ' checks ago, shoud notify');
				    let lookupTarget = "SELECT name, target FROM checks WHERE uuid = '" + notify.idcheck + "'";
				    cassandra.execute(lookupTarget, [], cst.readConsistency())
					.then((tgt) => {
						let mytarget = tgt.rows[0] || { target: 'undefined', name: 'undefined' };
						if (notify.notifydriver === 'http-get') {
						    let renderUrl = notify.notifytarget.replace(':status:', ((resp.rows[0].value === true) ? 'up' : 'down')).replace(':target:', encodeURIComponent(mytarget.target)).replace(':targetname:', encodeURIComponent(mytarget.name));
						    requestAsync({
								headers: { 'User-Agent': 'HighWayToHell-Notify' },
								url: renderUrl
							    })
							.then((reply) => {
								logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + mytarget.target + ' / ' + mytarget.name);
								resolve(true);
							    })
							.catch((e) => {
								logger.error('failed sending http-get notification');
								logger.error(e);
								resolve(false);
							    });
						} else if (notify.notifydriver === 'http-post') {
						    let bodyMsg = (resp.rows[0].value === true) ? (mytarget.name + ' is back up') : (mytarget.name + ' is down');
						    requestAsync({
								body: "{\"text\": \"" + bodyMsg + "\"}",
								headers: { 'User-Agent': 'HighWayToHell-Notify' },
								method: 'POST',
								url: notify.notifytarget
							    })
							.then((reply) => {
								logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + mytarget.target + ' / ' + mytarget.name);
								resolve(true);
							    })
							.catch((e) => {
								logger.error('failed sending http-post notification');
								logger.error(e);
								resolve(false);
							    });
						} else if (notify.notifydriver === 'contacts') {
						    if (notify.notifytarget.indexOf('@') > 0) {
							let subst = {
								checkname: mytarget.name,
								state: (resp.rows[0].value === true ? 'up' : 'down'),
								target: mytarget.target
							    };
							sendMail(notify.notifytarget, 'notify', subst)
							    .then((ok) => {
								    logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + mytarget.target + ' / ' + mytarget.name);
								    resolve(true);
								})
							    .catch((e) => {
								    logger.error('failed sending mail notification');
								    logger.error(e);
								    resolve(false);
								});
						    } else {
							sendSMS(notify.notifytarget, (resp.rows[0].value === true) ? (mytarget.name + ' is back up') : (mytarget.name + ' is down'))
							    .then((rsp) => {
								    logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + mytarget.target + ' / ' + mytarget.name);
								    resolve(true);
								})
							    .catch((e) => {
								    logger.error('failed sending sms notification');
								    logger.error(e);
								    resolve(false);
								});
						    }
						} else {
						    logger.error('notify driver ' + notify.notifydriver + ' not implemented');
						    resolve(false);
						}
					    })
					.catch((e) => {
						logger.error('failed looking up target formatting notification, discarding');
						logger.error(e);
						resolve(false);
					    });
				} else { resolve(false); }
			    } else { resolve(false); }
			})
		    .catch((e) => { reject('failed querying check history'); });
	    });
    };
