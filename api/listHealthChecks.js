const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let queryChecks = "SELECT * FROM checks WHERE origin = '" + domain + "'";
		cassandra.execute(queryChecks, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { resolve([]); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
