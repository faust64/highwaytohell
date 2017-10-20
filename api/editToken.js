const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId, tokenObject) => {
	return new Promise ((resolve, reject) => {
		    let updateToken = "UPDATE tokens SET permissions = ' " + tokenObject.perms + " ', trusted = ' "
			+ tokenObject.src + "' WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenObject.id + "'";
		    cassandra.execute(updateToken, [], { consistency: drv.types.consistencies.localQuorum })
			.then((resp) => { resolve(true); })
			.catch((e) => { reject('failed querying cassandra'); });
	    });
    };
