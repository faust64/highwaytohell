const Promise = require('bluebird');

module.exports = (cassandra, userId, domain) => {
	return new Promise ((resolve, reject) => {
		let queryDomain = "SELECT * FROM zones WHERE idowner = '" + userId + "' AND origin = '" + domain + "'";
		cassandra.execute(queryDomain)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) { resolve(resp.rows[0]);
			    } else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
