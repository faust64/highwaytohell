const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId, type, value) => {
	return new Promise ((resolve, reject) => {
		let setNotifySettings = "UPDATE users SET " + type + " = " + value + " WHERE uuid = '" + userId + "'";
		cassandra.execute(setNotifySettings, [], { consistency: drv.types.consistencies.localQuorum })
		    .then((ok) => { resolve(true); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
