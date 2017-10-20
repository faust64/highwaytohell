const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let secret = require('speakeasy').generateSecret({ length: 16, name: 'HighWayToHell', issuer: 'UTGB', 'google_auth_qr': false });
		let updateUser = "UPDATE twofa SET secret = '" + secret.base32 + "' WHERE uuid = '" + userId + "'";
		cassandra.execute(updateUser, [], cst.writeConsistency())
		    .then((resp) => { resolve(secret); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
