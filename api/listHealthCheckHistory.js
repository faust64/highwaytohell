const Promise = require('bluebird');

module.exports = (cassandra, checkId) => {
	return new Promise ((resolve, reject) => {
		let queryHistory = "SELECT when, value FROM checkhistory WHERE uuid = '" + checkId + "'";
		cassandra.execute(queryHistory)
		    .then((resp) => { resolve(resp.rows || []); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
