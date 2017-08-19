const Promise = require('bluebird');
const logger = require('./logger.js')('notify-worker');
const request = require('request');
const requestAsync = Promise.promisify(request);
const sendMail = require('./sendMail.js');

module.exports = (cassandra, twilio, notify) => {
	return new Promise((resolve, reject) => {
		let watchFor = 1 + ((notify.notifydownafter > notify.notifyupafter) ? notify.notifydownafter : notify.notifyupafter);
		let lookupHistory = "SELECT * FROM checkhistory WHERE uuid = '" + notify.idcheck + "' ORDER BY when DESC limit " + watchFor;
		cassandra.execute(lookupHistory)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined && resp.rows[0].when !== undefined) {
				let limit = (resp.rows[0].value === true) ? notify.notifyupafter : notify.notifydownafter;
				let count = 1;
				for (; count < resp.rows.length; count++) {
				    if (resp.rows[0].value !== resp.rows[count].value) { break; }
				}
				if (count === limit) {
				    logger.info('status changed ' + count + ' checks ago, shoud notify');
				    let lookupTarget = "SELECT name, target FROM checks WHERE uuid = '" . notify.idcheck + "'";
				    cassandra.execute(lookupTarget)
					.then((tgt) => {
						if (notify.notifydriver === 'http-get') {
						    let renderUrl = notify.notifytarget.replace(':status:', ((resp.rows[0].value === true) ? 'up' : 'down')).replace(':target:', encodeURIComponent(tgt.target)).replace(':targetname:', encodeURIComponent(tgt.name));
						    requestAsync({
								headers: { 'User-Agent': 'HighWayToHell-Notify' },
								url: renderUrl
							    })
							.then((reply) => {
								logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + tgt.target + ' / ' + tgt.name);
								resolve(true);
							    })
							.catch((e) => {
								logger.error('failed sending http-get notification');
								logger.error(e);
								resolve(false);
							    });
						} else if (notify.notifydriver === 'http-post') {
						    let bodyMsg = (resp.rows[0].value === true) ? (tgt.name + ' is back up') : (tgt.name + ' is down');
						    requestAsync({
								body: "{\"text\": \"" + bodyMsg + "\"}",
								headers: { 'User-Agent': 'HighWayToHell-Notify' },
								method: 'POST',
								url: notify.notifytarget
							    })
							.then((reply) => {
								logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + tgt.target + ' / ' + tgt.name);
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
								checkname: tgt.name,
								state: (resp.rows[0].value === true ? 'up' : 'down'),
								target: tgt.target
							    };
							sendMail(notify.notifytarget, 'notify', subst)
							    .then((ok) => {
								    logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + tgt.target + ' / ' + tgt.name);
								    resolve(true);
								})
							    .catch((e) => {
								    logger.error('failed sending mail notification');
								    logger.error(e);
								    resolve(false);
								});
						    } else if (twilio !== false) {
							twilio.message.create({
								body: (resp.rows[0].value === true) ? (tgt.name + ' is back up') : (tgt.name + ' is down'),
								from: process.env.TWILIO_FROM,
								to: (notify.notifytarget.indexOf('+') === 0) ? notify.notifytarget : ('+' + notify.notifytarget)
							    }, (e, rsp) => {
								if (e) {
								    logger.error('failed sending sms notification');
								    logger.error(e);
								    resolve(false);
								} else {
								    logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.idcheck + ' / ' + tgt.target + ' / ' + tgt.name);
								    resolve(true);
								}
							    });
						    } else {
							logger.info('notify driver SMS is not configured, discarding event');
							resolve(false);
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
