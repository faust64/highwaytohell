const Promise = require('bluebird');

module.exports = (cassandra, userId, emailaddr) => {
	return new Promise ((resolve, reject) => {
		let updateUser = "UPDATE users SET emailaddress = '" + emailaddr + "' WHERE uuid = '" + userId + "'";
		cassandra.execute(updateUser)
		    .then((resp) => { resolve('address changed to ' + emailaddr); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
