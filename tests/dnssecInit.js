const cassandra = require('cassandra-driver');
const dnssecInit = require('../lib/dnssecInit.js');

const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });
const sampleObject = [
	{ origin: 'peerio.biz', idowner: 'salut' },
	{ origin: 'peerio.com', idowner: 'pouet' }
    ];
const Promise = require('bluebird');

var promises = [];

sampleObject.forEach(obj => {
	promises.push(new dnssecInit.DnssecInit(client, obj));
    });

Promise.all(promises)
    .then(() => { console.log('done with this one'); process.exit(0); });
