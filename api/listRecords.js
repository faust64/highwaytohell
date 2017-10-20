const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let queryRecords = "SELECT * FROM records WHERE origin = '" + domain + "'";
		cassandra.execute(queryRecords, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
