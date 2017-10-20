const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, token) => {
	return new Promise ((resolve, reject) => {
		let queryToken = "SELECT emailaddress, confirmcode FROM users WHERE uuid = '" + userId + "'";
		cassandra.execute(queryToken, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				if (token === resp.rows[0].confirmcode) {
				    let emailaddr = resp.rows[0].emailaddress;
				    let confirmRegistered = "UPDATE users SET confirmcode = 'true' WHERE uuid = '" + userId + "'";
				    cassandra.execute(confirmRegistered, [], cst.writeConsistency())
					.then((cnf) => {
						let trustContact = "INSERT INTO contactaddresses (uuid, type, target, confirmcode) VALUES ('" + userId + "', 'smtp', '" + emailaddr + "', 'true')";
						cassandra.execute(trustContact, [], cst.writeConsistency())
						    .then((trust) => { resolve(true); })
						    .catch((e) => { reject('failed trusting address receiving alerts, registration succeeded nevertheless'); });
					    })
					.catch((e) => { reject('failed marking user registered'); });
				} else { reject('invalid token'); }
			    } else { reject('request not found'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
