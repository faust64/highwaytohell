const Promise = require('bluebird');

module.exports = (cassandra, userId, domain) => {
	return new Promise ((resolve, reject) => {
		let queryDS = "SELECT ds FROM dsrecords WHERE origin = '" + domain + "' AND idowner = '" + userId + "'";
		cassandra.execute(queryDS)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) { resolve(resp.rows[0]);
			    } else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
