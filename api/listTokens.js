const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let getTokens = "SELECT * FROM tokens WHERE idowner = '" + userId + "'";
		cassandra.execute(getTokens, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
