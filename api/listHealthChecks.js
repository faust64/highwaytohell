const Promise = require('bluebird');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let queryChecks = "SELECT * FROM checks WHERE origin = '" + domain + "'";
		cassandra.execute(queryChecks)
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { resolve([]); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
