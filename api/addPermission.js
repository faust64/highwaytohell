const Promise = require('bluebird');

module.exports = (cassandra, domainName, perm) => {
	return new Promise ((resolve, reject) => {
		if (perm.thirdParty.indexOf('@') > 0) {
		    let getRemoteId = "SELECT uuid FROM users where emailaddress = '" + perm.thirdParty + "'";
		    cassandra.execute(getRemoteId)
			.then((usr) => {
				if (usr.rows !== undefined && usr.rows[0] !== undefined) {
				    if (usr.rows[0].uuid !== perm.settingUser) {
					let setPerms = "INSERT INTO rbaclookalike (domain, uuid, role) VALUES ('" + domainName + "', '" + usr.rows[0].uuid + "', '" + perm.assumesRole + "')";
					cassandra.execute(setPerms)
					    .then((resp) => { resolve(true); })
					    .catch((e) => { reject('failed inserting to cassandra'); });
				    } else { reject('can not change permissions for yourself'); }
				} else { reject('could not find user ' + perm.thirdParty); }
			    })
			.catch((e) => { reject('failed querying cassandra for third party user ID'); });
		} else if (perm.thirdParty !== perm.settingUser) {
		    let setPerms = "INSERT INTO rbaclookalike (domain, uuid, role) VALUES ('" + domainName + "', '" + perm.thirdParty + "', '" + perm.assumesRole + "')";
		    cassandra.execute(setPerms)
			.then((resp) => { resolve(true); })
			.catch((e) => { reject('failed inserting to cassandra'); });
		} else { reject('can not change permissions for yourself'); }
	    });
    };
