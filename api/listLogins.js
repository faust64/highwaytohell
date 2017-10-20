const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
	    let queryRecords = "SELECT time, clientip, succeeded FROM logins WHERE uuid = '" + userId + "' order by time desc limit 25";
		cassandra.execute(queryRecords, [], { consistency: drv.types.consistencies.localQuorum })
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
