const Promise = require('bluebird');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let queryPerms = "SELECT * FROM rbaclookalike WHERE domain = '" + domain + "'";
		cassandra.execute(queryPerms)
		    .then((perms) => {
			    if (perms.rows !== undefined && perms.rows[0] !== undefined) {
				let userids = [];
				let retWith = [];
				for (let k = 0; k < perms.rows.length; k++) {
				    userids.push(perms.rows[k].uuid);
				    retWith.push({ uuid: perms.rows[k].uuid, role: perms.rows[k].role });
				}
				let queryUsers = "SELECT uuid, emailaddress, username FROM users WHERE uuid IN ('" + userids.join("', '") + "')";
				cassandra.execute(queryUsers)
				    .then((users) => {
					    if (users.rows !== undefined && users.rows[0] !== undefined) {
						for (let k = 0; k < users.rows.length; k++) {
						    for (o = 0; o < retWith.length; o++) {
							if (retWith[o].uuid === users.rows[k].uuid) {
							    retWith[o].emailaddr = users.rows[k].emailaddress;
							    retWith[o].username = users.rows[k].username;
							    break ;
							}
						    }
						}
						resolve(retWith);
					    } else { reject('failed resolving users'); }
					})
				    .catch((e) => { reject('failed resolving users'); });
			    } else { resolve([]); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
