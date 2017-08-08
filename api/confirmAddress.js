const Promise = require('bluebird');

module.exports = (cassandra, userId, token) => {
	return new Promise ((resolve, reject) => {
		let queryToken = "SELECT confirmcode FROM users WHERE uuid = '" + userId + "'";
		cassandra.execute(queryToken)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				if (token === resp.rows[0].confirmcode) {
				    let confirmRegistered = "UPDATE users SET confirmcode = 'true' WHERE uuid = '" + userId + "'";
				    cassandra.execute(confirmRegistered)
					.then((cnf) => { resolve(true); })
					.catch((e) => { reject('failed marking user registered'); });
				} else { reject('invalid token'); }
			    } else { reject('request not found'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
