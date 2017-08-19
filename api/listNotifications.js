const Promise = require('bluebird');

module.exports = (cassandra, domainName, checkId) => {
	return new Promise ((resolve, reject) => {
		let queryChecks = "SELECT uuid, name FROM checks WHERE origin = '" + domainName + "'";
		if (checkId !== false) { queryChecks += " AND uuid = '" + checkId + "'"; }
		cassandra.execute(queryChecks)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let queryNotifications = "SELECT * FROM notifications WHERE idcheck IN ('";
				let checkIds = [];
				for (let k = 0; k < resp.rows.length; k++) { checkIds.push(resp.rows[k].uuid); }
				if (checkId !== false && checkIds.indexOf(checkId) >= 0) {
				    queryNotifications += checkId;
				} else { queryNotifications += checkIds.join("', '"); }
				queryNotifications += "')";
				cassandra.execute(queryNotifications)
				    .then((ret) => {
					    for (let k = 0; k < ret.rows.length; k++) {
						for (let o = 0; o < resp.rows.length; o++) {
						    if (resp.rows[o].uuid === ret.rows[k].idcheck) {
							ret.rows[k].name = resp.rows[o].name;
							break ;
						    }
						}
					    }
					    if (checkId !== false && checkIds.indexOf(checkId) >= 0) { resolve(ret.rows[0] || {}); }
					    else { resolve(ret.rows || []); }
					})
				    .catch((e) => { reject('failed listing notifications'); });
			    } else { resolve(checkId !== false ? {} : []); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
