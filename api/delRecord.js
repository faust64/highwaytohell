const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId, recordObject) => {
	return new Promise ((resolve, reject) => {
		let dropRecord = "DELETE FROM records WHERE origin = '" + recordObject.origin + "' AND type = '"
			+ recordObject.type + "' AND name = '" + recordObject.name + "' AND setid = '" + recordObject.setId + "'";
		cassandra.execute(dropRecord, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => { resolve({}); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
