const Promise = require('bluebird');

module.exports = (cassandra, userId, emailaddr) => {
	return new Promise ((resolve, reject) => {
		let checkContact = "SELECT confirmcode FROM contactaddresses WHERE uuid = '" + userId + "' AND target = '" + emailaddr + "'";
		cassandra.execute(checkContact)
		    .then((trusted) => {
			    if (trusted.rows !== undefined && trusted.rows[0] !== undefined && trusted.rows[0].confirmcode === 'true') {
				let updateUser = "UPDATE users SET emailaddress = '" + emailaddr + "' WHERE uuid = '" + userId + "'";
				cassandra.execute(updateUser)
				    .then((resp) => { resolve('address changed to ' + emailaddr); })
				    .catch((e) => { reject('failed querying cassandra'); });
			    } else { reject('contact not trusted yet'); }
			})
		    .catch((e) => { reject('failed querying cassandra for trusted contacts'); });
	    });
    };
