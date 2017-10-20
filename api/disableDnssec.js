const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let getZone = "SELECT ksk, zsk FROM zones WHERE origin = '" + domain + "'";
		let disableDnssec = "UPDATE zones SET ksk = null, zsk = null WHERE origin = '" + domain + "'";
		cassandra.execute(getZone, [], cst.readConsistency())
		    .then((keys) => {
			    let purgeKeys = "DELETE FROM dnsseckeys WHERE ksk = '" + keys.rows[0].ksk + "' AND zsk = '" + keys.rows[0].ksk + "'";
			    cassandra.execute(disableDnssec, [], cst.writeConsistency())
				.then((resp) => {
					cassandra.execute(purgeKeys, [], cst.writeConsistency())
					    .then((purge) => { resolve({}); })
					    .catch((e) => { reject('failed purging keys'); });
				    })
				.catch((e) => { reject('failed disabling dnssec'); });
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
