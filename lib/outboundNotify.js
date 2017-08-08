const Promise = require('bluebird');
const logger = require('./logger.js')('notify-worker');
const request = require('request');

const requestAsync = Promise.promisify(request);

class OutboundNotify {
    constructor(cassandra, twilio, notify) {
	    return new Promise((resolve, reject) => {
		    let watchFor = 1 + ((notify.notifydownafter > notify.notifyupafter) ? notify.notifydownafter : notify.notifyupafter);
		    let lookupHistory = "SELECT * FROM checkhistory WHERE uuid = '" + notify.checkid + "' ORDER BY when DESC limit " + watchFor;
		    cassandra.execute(lookupHistory)
			.then((resp) => {
				if (resp.rows !== undefined && resp.rows[0] !== undefined && resp.rows[0].when !== undefined) {
				    let limit = (resp.rows[0].value === true) ? notify.notifyupafter : notify.notifydownafter;
				    for (let k = 1; k < resp.rows.length; k++) {
					if (resp.rows[0].value !== resp.rows[k].value) { break; }
				    }
				    if (k === limit) {
					logger.info('status changed ' + k + ' checks ago, shoud notify');
					let lookupTarget = "SELECT target FROM checks WHERE uuid = '" . notify.checkid + "'";
					cassandra.execute(lookupTarget)
					    .then((tgt) => {
						    if (notify.notifydriver  === 'http-get') {
							requestAsync({
								    headers: { 'User-Agent': 'HighWayToHell-Notify' },
								    url: notify.notifytarget
								})
							    .then((reply) => {
								    logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.checkid + ' / ' + tgt.target);
								    resolve(true);
								})
							    .catch((e) => {
								    logger.error('failed sending http-get notification');
								    logger.error(e);
								    resolve(false);
								});
						    } else if (notify.notifydriver  === 'http-post') {
							let bodyMsg = (resp.rows[0].value === true) ? (tgt.target + ' is back up') : (tgt.target + ' is down');
							requestAsync({
								    body: "{\"text\": \"" + bodyMsg + "\"}",
								    headers: { 'User-Agent': 'HighWayToHell' },
								    method: 'POST',
								    url: notify.notifytarget
								})
							    .then((reply) => {
								    logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.checkid + ' / ' + tgt.target);
								    resolve(true);
								})
							    .catch((e) => {
								    logger.error('failed sending http-get notification');
								    logger.error(e);
								    resolve(false);
								});
						    } else if (notify.notifydriver === 'mail') {
							/* NOT IMPLEMENTED YET - should make sendMail more modular */
							logger.error('FIXME - mail not implemented yet');
							resolve(true);
						    } else if (notify.notifydriver === 'sms') {
							if (twilio !== false) {
							    twilio.message.create({
								    body: (resp.rows[0].value === true) ? (tgt.target + ' is back up') : (tgt.target + ' is down'),
								    from: process.env.TWILIO_FROM,
								    to: (notify.notifytarget.indexOf('+') === 0) ? notify.notifytarget : ('+' + notify.notifytarget)
								}, (e, rsp) => {
								    if (e) {
									logger.error('failed sending sms notification');
									logger.error(e);
									resolve(false);
								    } else {
									logger.info('notified ' + notify.notifytarget + ' regarding ' + notify.checkid + ' / ' + tgt.target);
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
				}
			    })
			.catch((e) => { reject('failed querying check history'); });	
		});
	}
}

exports.OutboundNotify = OutboundNotify;
