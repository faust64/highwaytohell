const Promise = require('bluebird');

module.exports = (cassandra, domain, idowner) => {
	return new Promise ((resolve, reject) => {
		/* FIXME: notify refreshZones */
		let disableDnssec = "UPDATE zones SET ksk = null, zsk = null WHERE origin = '" + domain + "' AND idowner = '" + idowner + "'";
		cassandra.execute(disableDnssec)
		    .then((resp) => {
				resolve({});
		    /*
			let purgeKeys = "DELETE FROM dnsseckeys WHERE ksk = '" + ksk + "' AND zsk = '" + ksk + "'";
			cassandra.execute(purgeKeys)
			    .then((purge) => {
				})
			    .catch((e) => {
				    reject('failed purging keys');
				});
		    */
			})
		    .catch((e) => { reject('failed disabling dnssec'); });
	})
    };
