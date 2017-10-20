const Promise = require('bluebird');
const crypto = require('crypto');
const cst = require('../lib/cassandra.js');
const sendMail = require('../lib/sendMail.js');
const sendSMS = require('../lib/sendSMS.js');

module.exports = (cassandra, userId, username, type, target) => {
	return new Promise ((resolve, reject) => {
		let checkExisting = "SELECT confirmcode FROM contactaddresses WHERE uuid = '" + userId + "' AND target = '" + target + "'";
		cassandra.execute(checkExisting, [], cst.readConsistency())
		    .then((exist) => {
			    if (exist.rows !== undefined && exist.rows[0] !== undefined && exist.rows[0].confirmcode !== undefined) { reject('contact already registered'); }
			    else {
				if (type === 'smtp') {
				    crypto.randomBytes(48, function(e, buf) {
					    if (e) { reject('failed generating token'); }
					    else {
						let token = buf.toString('hex');
						let subst = {
							confirmUri: '/settings/confirm-contact/' + userId + '/' + token,
							username: username
						    };
						sendMail(target, 'acknotify', subst)
						    .then((ok) => {
							    let insertContact = "INSERT INTO contactaddresses (uuid, type, target, confirmcode) VALUES ('" + userId + "', 'smtp', '" + target + "', '" + token + "')";
							    cassandra.execute(insertContact, [], cst.writeConsistency())
								.then((resp) => { resolve(true); })
								.catch((de) => { reject('failed writing token to cassandra'); });
							})
						    .catch((de) => { reject(de); });
					    }
				    });
				} else if (type === 'sms') {
				    let token =  String(Math.floor(Math.random() * 999999));
				    token = ("000000" + token).substr(token.length);
				    sendSMS(target, 'Your HighWayToHell confirmation code is ' + token)
					.then((ok) => {
						let insertContact = "INSERT INTO contactaddresses (uuid, type, target, confirmcode) VALUES ('" + userId + "', 'sms', '" + target + "', '" + token + "')";
						cassandra.execute(insertContact, [], cst.writeConsistency())
						    .then((resp) => { resolve(true); })
						    .catch((e) => { reject('failed writing token to cassandra'); });
					    })
					.catch((e) => { reject(e); });
				} else { reject('unknown contact type'); }
			    }
			})
		    .catch((e) => { reject('failed querying cassandra for existing contact with matching address'); });
	    });
    };
