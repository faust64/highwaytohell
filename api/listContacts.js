const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let queryContacts = "SELECT * FROM contactaddresses WHERE uuid = '" + userId + "'";
		cassandra.execute(queryContacts, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
