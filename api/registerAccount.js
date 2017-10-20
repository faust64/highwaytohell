const Promise = require('bluebird');
const crypto = require('crypto');
const cst = require('../lib/cassandra.js');
const sendMail = require('../lib/sendMail.js');
const uuid = require('cassandra-driver').types.TimeUuid;

module.exports = (cassandra, username, emailaddr, password) => {
	return new Promise ((resolve, reject) => {
		let checkExisting = "SELECT uuid FROM users WHERE emailaddress = '" + emailaddr + "'";
		cassandra.execute(checkExisting, [], cst.readConsistency())
		    .then((exist) => {
			    if (exist.rows !== undefined && exist.rows[0] !== undefined && exist.rows[0].uuid !== undefined) {
				reject('emailaddress already registered');
			    } else {
				crypto.randomBytes(48, function(e, buf) {
					if (e) { reject('failed generating token'); }
					else {
					    let token = buf.toString('hex');
					    let pwHash = crypto.createHash('sha256').update(password).digest('hex');
					    let userId = uuid.now();
					    let subst = {
						    confirmUri: '/settings/confirm-address/' + userId + '/' + token,
						    username: username
						};
					    sendMail(emailaddr, 'registration', subst)
						.then((ok) => {
							let insertUser = "INSERT INTO users (uuid, username, emailaddress, pwhash, confirmcode, notifyfailed, notifylogin) VALUES "
							    +"('" + userId + "', '" + username + "', '" + emailaddr + "', '" + pwHash + "', '" + token + "', false, false)";
							cassandra.execute(insertUser, [], cst.writeConsistency())
							    .then((resp) => { resolve('user ' + username + ' created with uuid ' + userId); })
							    .catch((e) => { reject('failed querying cassandra'); });
						    })
						.catch((de) => { reject(de); });
					}
				    });
			    }
			})
		    .catch((e) => { reject('failed querying cassandra for existing user with matching address'); });
	    });
    };
