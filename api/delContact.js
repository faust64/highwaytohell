const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, target) => {
	return new Promise ((resolve, reject) => {
		let checkPrimary = "SELECT emailaddress FROM users WHERE uuid = '" + userId + "'";
		cassandra.execute(checkPrimary, [], cst.readConsistency())
		    .then((primary) => {
			    if (primary.rows !== undefined && primary.rows[0] !== undefined && primary.rows[0].emailaddress !== undefined && primary.rows[0].emailaddress === target) {
				reject('can not drop primary address');
			    } else {
				let dropContact = "DELETE FROM contactaddresses WHERE uuid = '" + userId + "' AND target = '" + target + "'";
				cassandra.execute(dropContact, [], cst.writeConsistency())
				    .then((resp) => { resolve(true); })
				    .catch((e) => { reject('failed querying cassandra'); });
			    }
			})
		    .catch((e) => { reject('failed querying cassandra for primary address'); });
	    });
    };
