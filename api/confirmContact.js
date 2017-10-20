const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, token) => {
	return new Promise ((resolve, reject) => {
		let queryToken = "SELECT target, confirmcode FROM contactaddresses WHERE uuid = '" + userId + "'";
		cassandra.execute(queryToken, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let matched = false;
				for (let k = 0; k < resp.rows.length; k++) {
				    if (token === resp.rows[k].confirmcode) {
					matched = true;
					let target = resp.rows[k].target;
					let confirmAddress = "UPDATE contactaddresses SET confirmcode = 'true' WHERE uuid = '" + userId + "' AND target = '" + target + "'";
					cassandra.execute(confirmAddress, [], cst.writeConsistency())
					    .then((trust) => { resolve(target); })
					    .catch((e) => { reject('failed trusting address receiving alerts'); });
		    		    }
				}
				if (matched === false) { reject('invalid token'); }
			    } else { reject('request not found'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
