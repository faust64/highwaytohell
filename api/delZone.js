const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, domainName) => {
	return new Promise ((resolve, reject) => {
		let dropRecords = "DELETE FROM records WHERE origin = '" + domainName + "'";
		let dropDomain = "DELETE FROM zones WHERE origin = '" + domainName + "'";
		let dropPerms = "DELETE FROM rbaclookalike WHERE domain = '" + domainName + "'";
		cassandra.execute(dropRecords, [], { consistency: drv.types.consistencies.localQuorum })
		    .then((drp) => {
			    cassandra.execute(dropPerms, [], { consistency: drv.types.consistencies.localQuorum })
				.then((perms) => {
					cassandra.execute(dropDomain, [], { consistency: drv.types.consistencies.localQuorum })
					    .then((resp) => { resolve('domain ' + domainName + ' dropped'); })
					    .catch((e) => { reject('failed querying cassandra dropping perms'); });
				    })
				.catch((e) => { reject('failed querying cassandra'); });
			})
		    .catch((e) => { reject('failed querying cassandra dropping records'); });
	    });
    };
