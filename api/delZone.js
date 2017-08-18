const Promise = require('bluebird');

module.exports = (cassandra, domainName) => {
	return new Promise ((resolve, reject) => {
		let dropRecords = "DELETE FROM records WHERE origin = '" + domainName + "'";
		let dropDomain = "DELETE FROM zones WHERE origin = '" + domainName + "'";
		let dropPerms = "DELETE FROM rbaclookalike WHERE domain = '" + domainName + "'";
		cassandra.execute(dropRecords)
		    .then((drp) => {
			    cassandra.execute(dropPerms)
				.then((perms) => {
					cassandra.execute(dropDomain)
					    .then((resp) => { resolve('domain ' + domainName + ' dropped'); })
					    .catch((e) => { reject('failed querying cassandra dropping perms'); });
				    })
				.catch((e) => { reject('failed querying cassandra'); });
			})
		    .catch((e) => { reject('failed querying cassandra dropping records'); });
	    });
    };
