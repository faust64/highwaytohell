const Promise = require('bluebird');

module.exports = (cassandra, userId, recordObject) => {
	return new Promise ((resolve, reject) => {
	    /* FIXME: refresh nspool, updating zone */
	    /* FIXME: purge  health checks, histories, .... child entities */
		let dropRecord = "DELETE FROM records WHERE origin = '" + recordObject.origin + "' AND type = '"
			+ recordObject.type + "' AND name = '" + recordObject.name + "' AND setid = '" + recordObject.setId + "'";
		cassandra.execute(dropRecord)
		    .then((resp) => { resolve({}); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
