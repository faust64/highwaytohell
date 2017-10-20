const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domainName) => {
	return new Promise ((resolve, reject) => {
		let dropRecords = "DELETE FROM records WHERE origin = '" + domainName + "'";
		let dropDomain = "DELETE FROM zones WHERE origin = '" + domainName + "'";
		let dropPerms = "DELETE FROM rbaclookalike WHERE domain = '" + domainName + "'";
		cassandra.execute(dropRecords, [], cst.writeConsistency())
		    .then((drp) => {
			    cassandra.execute(dropPerms, [], cst.writeConsistency())
				.then((perms) => {
					cassandra.execute(dropDomain, [], cst.writeConsistency())
					    .then((resp) => { resolve('domain ' + domainName + ' dropped'); })
					    .catch((e) => { reject('failed querying cassandra dropping perms'); });
				    })
				.catch((e) => { reject('failed querying cassandra'); });
			})
		    .catch((e) => { reject('failed querying cassandra dropping records'); });
	    });
    };
