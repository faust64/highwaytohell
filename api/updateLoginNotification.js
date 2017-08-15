const Promise = require('bluebird');

module.exports = (cassandra, userId, type, value) => {
	return new Promise ((resolve, reject) => {
		let setNotifySettings = "UPDATE users SET " + type + " = " + value + " WHERE uuid = '" + userId + "'";
		cassandra.execute(setNotifySettings)
		    .then((ok) => { resolve(true); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
