const Promise = require('bluebird');

module.exports = (cassandra, domainName, checkId) => {
	return new Promise ((resolve, reject) => {
		let queryChecks = "SELECT uuid FROM checks WHERE origin = '" + domainName + "'";
		if (checkId !== false) {
		    queryChecks += " AND uuid = '" + checkId + "'";
		}
		cassandra.execute(queryChecks)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let queryNotifications = "SELECT * FROM notifications WHERE idcheck IN ('";
				let checkIds = [];
				for (let k = 0; k < resp.rows.length; k++) { checkIds.push(resp.rows[k].uuid); }
				queryNotifications += checkIds.join("', '");
				queryNotifications += "')";
				cassandra.execute(queryNotifications)
				    .then((ret) => {
					    if (checkId !== false) { resolve(ret.rows[0] || {}); }
					    else { resolve(ret.rows || []); }
					})
				    .catch((e) => { reject('failed listing notifications'); });
			    } else { reject('invalid cassandra response'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
