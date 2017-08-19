const Promise = require('bluebird');
const uuid = require('cassandra-driver').types.TimeUuid;

module.exports = (cassandra, domain, checkObject) => {
	return new Promise ((resolve, reject) => {
		let checkId = checkObject.uuid || uuid.now();
		let insertCheck = "INSERT INTO checks (uuid, origin, type, name, target, headers, "
			+ "match, nspool, requireHealthy, requireUnhealthy, invert) VALUES "
			+ "('" + checkId + "', '" + domain + "', '" + checkObject.type + "', '"
			+ checkObject.name + "', '" + checkObject.target + "', ";
		if (checkObject.headers !== false && checkObject.headers !== "") {
		    insertCheck += "'" + checkObject.headers + "'"
		} else { insertCheck += "null" }
		insertCheck += ", ";
		if (checkObject.match !== false) {
		    insertCheck += "'" + checkObject.match + "'";
		} else { insertCheck += "null"; }
		insertCheck += ", 'default', " + checkObject.healthyThreshold + ", "
			+ checkObject.unhealthyThreshold + ", "
			+ (checkObject.invert === true ? 'true' : 'false') + ");";
		cassandra.execute(insertCheck)
		    .then((resp) => { resolve(checkId); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
