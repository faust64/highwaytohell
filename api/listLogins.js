const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
	    let queryRecords = "SELECT time, clientip, succeeded FROM logins WHERE uuid = '" + userId + "' order by time desc limit 25";
		cassandra.execute(queryRecords, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
