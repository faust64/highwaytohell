const cassandra = require('cassandra-driver');
const generateNsConf = require('../lib/generateNsConf.js');

const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });

return new generateNsConf.GenerateNsConf(client)
    .then(() => {
	    console.log('done');
	    process.exit(0);
	})
    .catch((e) => {
	    console.log('failed somehow');
	    console.log(e);
	    process.exit(1);
	});
