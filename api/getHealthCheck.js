const Promise = require('bluebird');

module.exports = (cassandra, domain, checkId) => {
	return new Promise ((resolve, reject) => {
		let queryChecks = "SELECT * FROM checks WHERE uuid = '" +  checkId + "' AND origin = '" + domain + "'";
		cassandra.execute(queryChecks)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) { resolve(resp.rows[0]);
			    } else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
