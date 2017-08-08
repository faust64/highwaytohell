const Promise = require('bluebird');
const cassandra = require('cassandra-driver');
const dnssecUpdate = require('../lib/dnssecUpdate.js');

const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });

client.execute('SELECT * FROM zones')
    .then((resp) => {
	    if (resp.rows !== undefined) {
		let promises = [];
		for (let j = 0; j < resp.rows.length; j++) {
		    if (resp.rows[j].ksk !== undefined && resp.rows[j].ksk !== null && resp.rows[j].zsk !== undefined && resp.rows[j].zsk !== null) {
			promises.push(new dnssecUpdate.DnssecUpdate(client, resp.rows[j]));
		    } else {
			console.log('no dnssec for ' + resp.rows[j].origin);
		    }
		}
		Promise.all(promises)
		    .then(() => {
			    console.log('done refreshing dnssec keys');
			    process.exit(0);
			});
	    }
	})
    .catch((e) => {
	    console.log('failed listing zones refreshing dnssec configuration');
	    console.log(e);
	    process.exit(1);
	});
