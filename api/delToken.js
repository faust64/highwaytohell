const Promise = require('bluebird');

module.exports = (cassandra, userId, tokenString) => {
	return new Promise ((resolve, reject) => {
		let dropToken = "DELETE FROM tokens WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenString + "'";
		cassandra.execute(dropToken)
		    .then((resp) => { resolve({}); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
