const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, domain, record, setid) => {
	return new Promise ((resolve, reject) => {
		let queryRecord = "SELECT * FROM records WHERE origin = '" + domain + "' AND setid = '" + setid + "' AND name = '" + record + "' AND type in ('A', 'CNAME', 'TXT', 'MX', 'SOA', 'PTR', 'NS', 'AAAA')";
			    /*FIXME: maybe remove type from PK?*/
		cassandra.execute(queryRecord, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) { resolve(resp.rows[0]); }
			    else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
