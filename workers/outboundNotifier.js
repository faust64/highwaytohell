const Promise = require('bluebird');
const Queue = require('bee-queue');
const cassandra = require('cassandra-driver');
const cst = require('../lib/cassandra.js');
const fs = require('fs');
const logger = require('../lib/logger.js')('outbound-notifier');
const outboundNotify = require('../lib/outboundNotify.js');
const pmxProbe = require('pmx').probe();
const schedule = require('node-schedule');
const sendMail = require('../lib/sendMail.js');
const workerPool = process.env.HWTH_POOL || 'default';

let cassandraOpts = {
	contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']),
	keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth'
    };
if (process.env.CASSANDRA_AUTH_USER && process.env.CASSANDRA_AUTH_PASS) {
    cassandraOpts.authProvider = new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_AUTH_USER, process.env.CASSANDRA_AUTH_PASS);
}
const beeProbe = pmxProbe.meter({ name: 'bee jobs per minute', sample: 60 });
const client = new cassandra.Client(cassandraOpts);
const neighbors = require('../lib/advertiseNeighbors.js')('notifiy-' + workerPool);
const redisBackend = process.env['REDIS_HOST_' + workerPool] || process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env['REDIS_PORT_' + workerPool] || process.env.REDIS_PORT || 6379;

const notifyQueue = new Queue('outbound-notify-' + workerPool, { removeOnSuccess: true, isWorker: true, redis: { port: redisPort, host: redisBackend }});

if (process.env.AIRBRAKE_ID !== undefined && process.env.AIRBRAKE_KEY !== undefined) {
    try {
	let airbrake = require('airbrake').createClient(process.env.AIRBRAKE_ID, process.env.AIRBRAKE_KEY);
	airbrake.handleExceptions();
    } catch(e) {
	logger.info('WARNING: failed initializing airbrake');
    }
}

notifyQueue.on('ready', () => { logger.info('ready'); });
notifyQueue.on('error', (e) => {
	logger.error('queue errored');
	logger.error(e);
	process.exit(1);
    });
notifyQueue.process((task, done) => {
	logger.info('processing ' + task.data.what || 'undefined');
	beeProbe.mark();
	if (task.data.what === 'healthcheck') {
	    let shouldNotify = "SELECT * FROM notifications WHERE idcheck = '" + task.data.checkid + "'";
	    client.execute(shouldNotify, [], cst.readConsistency())
		.then((notifs) => {
			if (notifs.rows !== undefined && notifs.rows[0] !== undefined) {
			    let promises = [];
			    for (let k = 0; k < notifs.rows.length; k++) {
				promises.push(outboundNotify(client, notifs.rows[k]));
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
	} else if (task.data.what === 'login' || task.data.what === 'failed login') {
	    let subst = {
		    action: (task.data.what === 'login' ? 'succeeded' : 'failed'),
		    history: []
		};
	    let lookupUser = "SELECT uuid, emailaddress, username FROM users WHERE ";
	    if (task.data.who.indexOf('@') < 0) {
		lookupUser += "uuid = '" + task.data.who + "'";
	    } else {
		lookupUser += "emailaddress = '" + task.data.who + "'";
	    }
	    client.execute(lookupUser, [], cst.readConsistency())
		.then((usr) => {
			if (usr.rows !== undefined && usr.rows[0] !== undefined) {
			    let lookupHistory = "select time, clientip, succeeded from logins where uuid = '" + usr.rows[0].uuid + "' order by time desc limit 5;"
			    subst.username = usr.rows[0].username;
			    client.execute(lookupHistory, [], cst.readConsistency())
				.then((hist) => {
					if (hist.rows !== undefined && hist.rows[0] !== undefined) {
					    for (let k = 0; k < hist.rows.length; k++) {
						let fmtDate = 'On ' + new Date(Math.round(hist.rows[k].time)).toISOString();
						let fmtRes = 'Login ' + (hist.rows[k].succeeded === true ? 'succeeded' : 'failed');
						subst.history.push({ date: fmtDate, result: fmtRes, fromip: ' from ' + hist.rows[k].clientip });
					    }
					}
					if (subst.history.length === 0) {
					    let fmtDate = new Date().toISOString();
					    let fmtRes = 'failed querying logins history';
					    subst.history.push({ date: fmtDate, result: fmtRes, fromip: '' });
					}
					sendMail(usr.rows[0].emailaddress, 'login', subst)
					    .then((ok) => {
						    logger.info('notified ' + usr.rows[0].emailaddress + ' regarding ' + task.data.what);
						    done();
						})
					    .catch((e) => {
						    logger.error('failed sending mail notification');
						    logger.error(e);
						});
				    })
				.catch((e) => {
					logger.error('failed querying logins history for ' + usr.rows[0].uuid);
					logger.error(e);
					subst.history.push({ date: fmtDate, result: fmtRes, fromip: '' });
					sendMail(usr.rows[0].emailaddress, 'login', subst)
					    .then((ok) => {
						    logger.info('notified ' + usr.rows[0].emailaddress + ' regarding ' + task.data.what);
						    done();
						})
					    .catch((e) => {
						    logger.error('failed sending mail notification');
						    logger.error(e);
						});
				    });
			} else {
			    logger.error('failed looking up user ' + task.data.who + ' notifying ' + task.data.what);
			    done();
			}
		    })
		.catch((e) => {
			logger.error('failed querying cassandra notifying for ' + task.data.what);
			logger.error(e);
		    });
	} else {
	    logger.error('discarding unknown task type ' + task.data.what);
	    done();
	}
    });

const checkStalledJobs = schedule.scheduleJob('* * * * *', () => {
	if (neighbors.isElectedMaster() !== true) {
	    logger.info('skipping keys retrieval on slaves');
	    return true;
	}
	notifyQueue.checkStalledJobs((err, num) => {
		const sfx = ' stalled jobs in notify queue, ' + workerPool + ' pool';
		if (err) {
		    logger.error('failed checking for' + sfx);
		    logger.error(err);
		} else { logger.info('has ' + num + sfx); }
	    });
    });
