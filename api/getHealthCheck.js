const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domain, checkId) => {
	return new Promise ((resolve, reject) => {
		let queryChecks = "SELECT * FROM checks WHERE uuid = '" +  checkId + "' AND origin = '" + domain + "'";
		cassandra.execute(queryChecks, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) { resolve(resp.rows[0]); }
			    else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
