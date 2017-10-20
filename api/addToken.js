const Promise = require('bluebird');
const crypto = require('crypto');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, idOwner, tokenObject) => {
	return new Promise ((resolve, reject) => {
		crypto.randomBytes(48, function(e, buf) {
			if (e) { reject('failed generating token'); }
			else {
			    let token = buf.toString('hex');
			    let insertToken = "INSERT INTO tokens (idowner, tokenstring, permissions, trusted) "
				    + "VALUES ('" + idOwner + "', '" + token + "', '" + tokenObject.perms + "', '" + tokenObject.src + "')";
			    cassandra.execute(insertToken, [], cst.writeConsistency())
				.then((resp) => { resolve(token); })
				.catch((e) => { reject('failed querying cassandra'); });
			}
		    });
	    });
    };
