const Promise = require('bluebird');

module.exports = (cassandra, userId, filter) => {
	return new Promise ((resolve, reject) => {
		let queryDomain = "SELECT * FROM zones WHERE idowner = '" + userId + "'";
		if (filter !== undefined && typeof filter === "string") {
		    queryDomain += " AND origin = '" + filter + "'";
		}
		cassandra.execute(queryDomain)
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
