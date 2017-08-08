const Promise = require('bluebird');

module.exports = (cassandra, userId, tokenObject) => {
	return new Promise ((resolve, reject) => {
		    let updateToken = "UPDATE tokens SET permissions = ' " + tokenObject.perms + " ', trusted = ' "
			+ tokenObject.src + "' WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenObject.id + "'";
		    cassandra.execute(updateToken)
			.then((resp) => { resolve(true); })
			.catch((e) => { reject('failed querying cassandra'); });
	    });
    };
