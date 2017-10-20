const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domainName, checkId) => {
	return new Promise ((resolve, reject) => {
		    let checkPerm = "SELECT uuid FROM checks WHERE uuid = '" + checkId + "' AND origin = '" + domainName + "'";
		    cassandra.execute(checkPerm, [], cst.readConsistency())
			.then((chk) => {
				if (chk.rows !== undefined && chk.rows[0] !== undefined) {
				    let dropNotification = "DELETE FROM notifications WHERE idcheck = '" + checkId + "'";
				    cassandra.execute(dropNotification, [], cst.writeConsistency())
					.then((resp) => { resolve(true); })
					.catch((e) => { reject('failed dropping notification'); });
				} else { reject('check not found'); }
			    })
			.catch((e) => { reject('failed querying cassandra'); });
	    });
    };
