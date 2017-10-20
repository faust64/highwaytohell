const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, type, value) => {
	return new Promise ((resolve, reject) => {
		let setNotifySettings = "UPDATE users SET " + type + " = " + value + " WHERE uuid = '" + userId + "'";
		cassandra.execute(setNotifySettings, [], cst.writeConsistency())
		    .then((ok) => { resolve(true); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
