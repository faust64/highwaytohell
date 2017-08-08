const cassandra = require('cassandra-driver');
const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });
const checkHealth = require('../lib/checkHealth.js');
const sampleObject = [
	{ id: 1, type: 'icmp', target: '8.8.8.8', invert: false },
	{ id: 2, type: 'http', target: 'https://54.198.78.160/ping', headers: 'icebear.peerio.com', invert: false },
	{ id: 3, type: 'http', target: 'https://54.198.78.160/ping', headers: 'iceblobvirginia.peerio.com', match: 'OK', invert: false },
	{ id: 4, type: 'http', target: 'https://54.198.78.160/ping', headers: 'iceblob.peerio.com', match: 'OK', invert: false }
    ];
const Promise = require('bluebird');

var promises = [];

sampleObject.forEach(obj => {
	promises.push(new checkHealth.CheckHealth(client, obj));
    });

Promise.all(promises)
    .then(() => { console.log('done with that one'); process.exit(0); });
