const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, domainName, notObj) => {
	return new Promise ((resolve, reject) => {
		    let checkPerm = "SELECT uuid FROM checks WHERE uuid = '" + notObj.checkId + "' AND origin = '" + domainName + "'";
		    cassandra.execute(checkPerm, [], cst.readConsistency())
			.then((chk) => {
				if (chk.rows !== undefined && chk.rows[0] !== undefined) {
				    if (notObj.driver === 'contacts') {
					let checkContact = "SELECT confirmcode FROM contactaddresses WHERE uuid = '" + userId + "' AND target = '" + notObj.target + "'";
					cassandra.execute(checkContact, [], cst.readConsistency())
					    .then((knownContacts) => {
						    if (knownContacts.rows !== undefined && knownContacts.rows[0].confirmcode === 'true') {
							let insertNotification = "INSERT INTO notifications (idcheck, notifydownafter, notifyupafter, notifydriver, notifytarget) VALUES "
								+ "('" + notObj.checkId + "', " + notObj.downAfter + ", " + notObj.upAfter + ", '" + notObj.driver + "', '" + notObj.target + "')";
							cassandra.execute(insertNotification, [], cst.writeConsistency())
							    .then((resp) => { resolve(true); })
							    .catch((e) => { reject('failed inserting notification'); });
						    } else if (knownContacts.rows !== undefined && knownContacts.rows[0] !== undefined && knownContacts.rows[0].confirmcode !== 'true') {
							reject('contact is not trusted yet');
						    } else { reject('contact unkwnown'); }
						})
					    .catch((e) => { reject('failed querying cassandra for trusted contacts'); });
				    } else {
					let insertNotification = "INSERT INTO notifications (idcheck, notifydownafter, notifyupafter, notifydriver, notifytarget) VALUES "
						+ "('" + notObj.checkId + "', " + notObj.downAfter + ", " + notObj.upAfter + ", '" + notObj.driver + "', '" + notObj.target + "')";
					cassandra.execute(insertNotification, [], cst.writeConsistency())
					    .then((resp) => { resolve(true); })
					    .catch((e) => { reject('failed inserting notification'); });
				    }
				} else { reject('check not found'); }
			    })
			.catch((e) => { reject('failed querying cassandra'); });
	    });
    };
