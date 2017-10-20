const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, tokenString) => {
	return new Promise ((resolve, reject) => {
		let dropToken = "DELETE FROM tokens WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenString + "'";
		cassandra.execute(dropToken, [], cst.writeConsistency())
		    .then((resp) => { resolve({}); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
