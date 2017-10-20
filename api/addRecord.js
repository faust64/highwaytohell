const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domainName, recordObject) => {
	return new Promise ((resolve, reject) => {
		let checkConflict = "SELECT * FROM records WHERE origin = '" + domainName + "' AND name = '" + recordObject.name + "' AND TYPE IN ('A', 'AAAA', 'CNAME')";
		cassandra.execute(checkConflict, [], cst.readConsistency())
		    .then((cflt) => {
			    /*
			     * when A record exists, can't create CNAME
			     * when CNAME record exists, can't create A, can't create AAAA
			     * when AAAA record exists, can't create CNAME
			     */
			    let invalid = false;
			    if (cflt.rows !== undefined && cflt.rows[0] !== undefined && cflt.rows[0].type !== undefined) {
				if ((recordObject.type === 'A' || recordObject.type === 'AAAA') && cflt.rows[0].type === 'CNAME') {
				    invalid = 'can not create '+ recordObject.type +' when CNAME exists';
				}
				if (recordObject.type === 'CNAME' && (cflt.rows[0].type === 'A' || cflt.rows[0].type === 'AAAA')) {
				    invalid = 'can not create CNAME when A or AAAA exists';
				}
			    }
			    if (invalid !== false) { reject(invalid); }
			    else {
				let insertRecord = "INSERT INTO records (origin, name, priority, target, ttl, type, " + "setId, healthCheckId) VALUES ('" + domainName + "', '" + recordObject.name + "', " + recordObject.priority + ", '" + recordObject.target + "', " + recordObject.ttl + ", '" + recordObject.type + "', ";
				if (recordObject.setId !== false) {
				    insertRecord += "'" + recordObject.setId + "'";
				} else { insertRecord += "null"; }
				if (recordObject.healthCheckId !== false && recordObject.healthCheckId !== null && recordObject.healthCheckId !== "null" && recordObject.healthCheckId !== "static") {
				    insertRecord += ", '" + recordObject.healthCheckId + "')";
				} else { insertRecord += ", null)"; }
				cassandra.execute(insertRecord, [], cst.writeConsistency())
				    .then((resp) => {
					    if (recordObject.name === '@') { resolve(domainName); }
					    else { resolve(recordObject.name + '.' + domainName); }
					})
				    .catch((e) => { reject('failed inserting to cassandra'); });
			    }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
