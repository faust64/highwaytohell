const Promise = require('bluebird');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let queryContacts = "SELECT * FROM contactaddresses WHERE uuid = '" + userId + "'";
		cassandra.execute(queryContacts)
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
