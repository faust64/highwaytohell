const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, domainName, checkId) => {
	return new Promise ((resolve, reject) => {
		    let checkPerm = "SELECT uuid FROM checks WHERE uuid = '" + checkId + "' AND origin = '" + domainName + "'";
		    cassandra.execute(checkPerm, [], { consistency: drv.types.consistencies.one })
			.then((chk) => {
				if (chk.rows !== undefined && chk.rows[0] !== undefined) {
				    let dropNotification = "DELETE FROM notifications WHERE idcheck = '" + checkId + "'";
				    cassandra.execute(dropNotification, [], { consistency: drv.types.consistencies.one })
					.then((resp) => { resolve(true); })
					.catch((e) => { reject('failed dropping notification'); });
				} else { reject('check not found'); }
			    })
			.catch((e) => { reject('failed querying cassandra'); });
	    });
    };
