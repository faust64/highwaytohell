const Promise = require('bluebird');

module.exports = (cassandra, userId, emailaddr) => {
	return new Promise ((resolve, reject) => {
		let checkContact = "SELECT confirmcode FROM contactaddresses WHERE uuid = '" + userId + "' AND target = '" + emailaddr + "'";
		cassandra.execute(checkContact)
		    .then((trusted) => {
			    if (trusted.rows !== undefined && trusted.rows[0] !== undefined && trusted.rows[0].confirmcode === 'true') {
				let checkConflict = "SELECT uuid FROM users WHERE emailaddress = '" + emailaddr + "'";
				cassandra.execute(checkConflict)
				    .then((cflt) => {
					    let goahead = false;
					    if (cflt.rows !== undefined && clft.rows[0] !== undefined && cflt.rows[0].uuid !== undefined) {
						if (cflt.rows[0].uuid === userId) { goahead = true; }
					    } else { goahead = true; }
					    if (goahead) {
						let updateUser = "UPDATE users SET emailaddress = '" + emailaddr + "' WHERE uuid = '" + userId + "'";
						cassandra.execute(updateUser)
						    .then((resp) => { resolve('address changed to ' + emailaddr); })
						    .catch((e) => { reject('failed querying cassandra'); });
					    } else { reject('that address is already used by an other user as its primary contact'); }
					})
				    .catch((e) => { reject('failed querying backend for conflicting account'); });
			    } else { reject('contact not trusted yet'); }
			})
		    .catch((e) => { reject('failed querying cassandra for trusted contacts'); });
	    });
    };
