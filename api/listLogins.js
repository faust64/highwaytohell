const Promise = require('bluebird');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
	    let queryRecords = "select time, clientip, succeeded from logins where uuid = '" + userId + "' order by time desc limit 25";
		cassandra.execute(queryRecords)
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows);
			    } else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
