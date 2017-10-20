const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId, tokenString) => {
	return new Promise ((resolve, reject) => {
		let dropToken = "DELETE FROM tokens WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenString + "'";
		cassandra.execute(dropToken, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => { resolve({}); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
