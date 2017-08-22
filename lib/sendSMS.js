const Promise = require('bluebird');
const logger = require('./logger.js')('sms-notifier');
let smsHandle = false;
if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {
    try {
	smsHandle = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    } catch(e) {
	logger.error('WARNING: failed initializing twilio client');
	logger.error(e);
    }
}

module.exports = (recipient, body) => {
	return new Promise((resolve, reject) => {
		if (smsHandle !== false) {
		    smsHandle.messages.create({
			body: body,
			from: process.env.TWILIO_FROM,
			to: (recipient.indexOf('+') === 0) ? recipient : ('+' + recipient)
		    }, (e, rsp) => {
			if (e) {
			    logger.error('failed sending to ' + recipient);
			    logger.error(e);
			    reject('failed sending sms');
			} else {
			    logger.info('sent message to ' + recipient);
			    resolve(true);
			}
		    });
		} else { reject('SMS API not configured'); }
	    });
    };
