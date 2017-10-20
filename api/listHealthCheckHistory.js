const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, checkId) => {
	return new Promise ((resolve, reject) => {
		let queryHistory = "SELECT when, value FROM checkhistory WHERE uuid = '" + checkId + "'";
		cassandra.execute(queryHistory, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => { resolve(resp.rows || []); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
