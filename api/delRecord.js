const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, recordObject) => {
	return new Promise ((resolve, reject) => {
		let dropRecord = "DELETE FROM records WHERE origin = '" + recordObject.origin + "' AND type = '"
			+ recordObject.type + "' AND name = '" + recordObject.name + "' AND setid = '" + recordObject.setId + "'";
		cassandra.execute(dropRecord, [], cst.writeConsistency())
		    .then((resp) => { resolve({}); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
