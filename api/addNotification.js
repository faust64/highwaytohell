const Promise = require('bluebird');

module.exports = (cassandra, domainName, checkId, notObj) => {
	return new Promise ((resolve, reject) => {
	    /*
	     * FIXME: registering smtp notification, we can't trust user input unless matches email in user account
	     */
		    let checkPerm = "SELECT uuid FROM checks WHERE uuid = '" + checkId + "' AND origin = '" + domainName + "'";
		    cassandra.execute(checkPerm)
			.then((chk) => {
				if (chk.rows !== undefined && chk.rows[0] !== undefined) {
				    let insertNotification = "INSERT INTO notifications (idcheck, notifydownafter, notifyupafter, notifydriver, notifytarget) VALUES "
					    + "('" + checkId + "', " + notObj.downAfter + ", " + notObj.upAfter + ", '" + notObj.driver + "', '" + notObj.target + "')";
				    cassandra.execute(insertNotification)
					.then((resp) => { resolve(true); })
					.catch((e) => { reject('failed inserting notification'); });
				} else {
				    reject('check not found');
				}
			    })
			.catch((e) => { reject('failed querying cassandra'); });
	    });
    };
