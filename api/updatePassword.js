const Promise = require('bluebird');
const crypto = require('crypto');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, password) => {
	return new Promise ((resolve, reject) => {
		let pwHash = crypto.createHash('sha256').update(password).digest('hex');
		let updateUser = "UPDATE users SET pwhash = '" + pwHash + "' WHERE uuid = '" + userId + "'";
		cassandra.execute(updateUser, [], cst.writeConsistency())
		    .then((resp) => { resolve('password changed for ' + userId); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
