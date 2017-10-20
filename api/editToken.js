const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, tokenObject) => {
	return new Promise ((resolve, reject) => {
		    let updateToken = "UPDATE tokens SET permissions = ' " + tokenObject.perms + " ', trusted = ' "
			+ tokenObject.src + "' WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenObject.id + "'";
		    cassandra.execute(updateToken, [], cst.writeConsistency())
			.then((resp) => { resolve(true); })
			.catch((e) => { reject('failed querying cassandra'); });
	    });
    };
