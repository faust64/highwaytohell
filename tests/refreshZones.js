const cassandra = require('cassandra-driver');
const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });
const generateZone = require('../lib/generateZone.js');
const listDomains = 'SELECT * FROM zones';

const Promise = require('bluebird');

client.execute(listDomains)
    .then(result => {
	    if (result.rows !== undefined) {
		var promises = [];

		result.rows.forEach(function (dom) {
			promises.push(new generateZone.GenerateZone(client, dom, true))
		    });

		Promise.all(promises)
		    .then(() => { console.log('done here too'); process.exit(0); });
	    } else {
		console.log('failed listing domains, cassandra returned' + JSON.stringify(result));
		process.exit(1);
	    }
	})
    .catch((e) => {
	    console.log('failed querying cassandra');
	    process.exit(1);
	});
