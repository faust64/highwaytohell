const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let queryRecords = "SELECT * FROM records WHERE origin = '" + domain + "'";
		cassandra.execute(queryRecords, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
