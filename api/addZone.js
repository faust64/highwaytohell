const Promise = require('bluebird');
const defaultPool = process.env.HWTH_POOL || 'default';

module.exports = (cassandra, userId, domainName) => {
	return new Promise ((resolve, reject) => {
		/* FIXME: having created domain, we may want to ensure nspool's properly defined and generate our initial zone -even if empty of user-defined records? */
		let checkConflict = "SELECT * FROM zones WHERE origin = '" + domainName + "'";
		cassandra.execute(checkConflict)
		    .then((cflt) => {
			    if (cflt.rows !== undefined && cflt.rows[0] !== undefined && cflt.rows[0].idowner !== false) {
				if (userId === cflt.rows[0].idowner) { reject('zone already exists') }
				else { reject('zone was already registered') }
			    } else {
				    let insertDomain = "INSERT INTO zones (origin, idowner, nspool, serial) VALUES "
					+"('" + domainName + "', '" + userId + "', '" + defaultPool + "', '42')";
				    cassandra.execute(insertDomain)
					.then((resp) => { resolve('domain ' + domainName + ' created'); })
					.catch((e) => { reject('failed querying cassandra'); });
			    }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
