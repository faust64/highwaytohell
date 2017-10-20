const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let queryDS = "SELECT ds FROM dsrecords WHERE origin = '" + domain + "'";
		cassandra.execute(queryDS, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) { resolve(resp.rows[0]); }
			    else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
