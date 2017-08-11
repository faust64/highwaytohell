const Promise = require('bluebird');
const defaultPool = process.env.HWTH_POOL || 'default';
const defaultBackupPool = process.env.HWTH_BACKUP_POOL || 'default';

module.exports = (cassandra, userId, domainName) => {
	return new Promise ((resolve, reject) => {
		let checkConflict = "SELECT * FROM zones WHERE origin = '" + domainName + "'";
		cassandra.execute(checkConflict)
		    .then((cflt) => {
			    if (cflt.rows !== undefined && cflt.rows[0] !== undefined && cflt.rows[0].idowner !== false) {
				if (userId === cflt.rows[0].idowner) { reject('zone already exists') }
				else { reject('zone was already registered') }
			    } else {
				    let insertDomain = "INSERT INTO zones (origin, idowner, nspool, bkppool, serial) VALUES "
					+"('" + domainName + "', '" + userId + "', '" + defaultPool + "', '" + defaultBackupPool + "', '42')";
				    cassandra.execute(insertDomain)
					.then((resp) => { resolve('domain ' + domainName + ' created'); })
					.catch((e) => { reject('failed querying cassandra'); });
			    }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
