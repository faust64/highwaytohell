const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, checkId) => {
	return new Promise ((resolve, reject) => {
		let queryHistory = "SELECT when, value FROM checkhistory WHERE uuid = '" + checkId + "'";
		cassandra.execute(queryHistory, [], cst.readConsistency())
		    .then((resp) => { resolve(resp.rows || []); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
