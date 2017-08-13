const Promise = require('bluebird');
const Queue = require('bee-queue');
const cassandra = require('cassandra-driver');
const fs = require('fs');
const logger = require('../lib/logger.js')('outbound-notifier');
const outboundNotify = require('../lib/outboundNotify.js');
const pmxProbe = require('pmx').probe();
const redis = require('redis');

const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });
const workerPool = process.env.HWTH_POOL || 'default';

const redisBackend = process.env['REDIS_HOST_' + workerPool] || process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env['REDIS_PORT_' + workerPool] || process.env.REDIS_PORT || 6379;

const bullProbe = pmxProbe.meter({ name: 'bull jobs per minute', sample: 60 });
const notifyQueue = new Queue('outbound-notify-' + workerPool, { removeOnSuccess: true, isWorker: true, redis: { port: redisPort, host: redisBackend }});

let smsHandle = false;
if (process.env.AIRBRAKE_ID !== undefined && process.env.AIRBRAKE_KEY !== undefined) {
    try {
	let airbrake = require('airbrake').createClient(process.env.AIRBRAKE_ID, process.env.AIRBRAKE_KEY);
	airbrake.handleExceptions();
    } catch(e) {
	logger.info('WARNING: failed initializing airbrake');
    }
}
if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {
    try {
	smsHandle = require('twilio')(process.env.TWILIO_SID, PROCESS.env.TWILIO_TOKEN);
    } catch(e) {
	logger.error('WARNING: failed initializing twilio client');
	logger.error(e);
    }
}

notifyQueue.process((task, done) => {
    let shouldNotify = "SELECT * FROM notifications WHERE idcheck = '" + task.data.checkid + "'";
    client.execute(shouldNotify)
	.then((notifs) => {
		if (notifs.rows !== undefined && notifs.rows[0] !== undefined) {
		    let promises = [];
		    for (let k = 0; k < notifs.rows.length; k++) {
			promises.push(new outboundNotify.OutboundNotify(client, smsHandle, notifs.rows[0]))
		    }
		    Promise.all(promises)
			.then((ret) => {
				logger.info('done processing notifications for ' + task.data.checkid);
				done();
			    })
			.catch((e) => {
				logger.error('failed processing notifications for ' + task.data.checkid);
				logger.error(e);
			    });
		} else {
		    if (process.env.DEBUG) { logger.info('no notification to process for ' + task.data.checkid); }
		    done();
		}
	    })
	.catch((e) => {
		logger.error('failed querying notifications');
		logger.error(e);
	    });
    });
