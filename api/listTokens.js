const Promise = require('bluebird');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let getTokens = "SELECT * FROM tokens WHERE idowner = '" + userId + "'";
		cassandra.execute(getTokens)
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows);
			    } else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
