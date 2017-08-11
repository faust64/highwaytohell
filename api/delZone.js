const Promise = require('bluebird');

module.exports = (cassandra, userId, domainName) => {
	return new Promise ((resolve, reject) => {
		let dropRecords = "DELETE FROM records WHERE origin = '" + domainName + "'";
		cassandra.execute(dropRecords)
		    .then((drp) => {
			    let dropDomain = "DELETE FROM zones WHERE origin = '" + domainName + "' AND idowner = '" + userId + "'";
			    cassandra.execute(dropDomain)
				.then((resp) => { resolve('domain ' + domainName + ' dropped'); })
				.catch((e) => { reject('failed querying cassandra'); });
			})
		    .catch((e) => { reject('failed querying cassandra dropping records'); });
	    });
    };
