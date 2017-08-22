const Promise = require('bluebird');
const Queue = require('bee-queue');
const cassandra = require('cassandra-driver');
const dnssecUpdate = require('../lib/dnssecUpdate.js');
const exec = require('child_process').exec;
const fs = require('fs');
const generateNsConf = require('../lib/generateNsConf.js');
const generateZone = require('../lib/generateZone.js');
const logger = require('../lib/logger.js')('refresh-zones-worker');
const os = require('os');
const pmxProbe = require('pmx').probe();
const redis = require('redis');
const schedule = require('node-schedule');

let cassandraOpts = {
	contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']),
	keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth'
    };
if (process.env.CASSANDRA_AUTH_USER && process.env.CASSANDRA_AUTH_PASS) {
    cassandraOpts.authProvider = new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_AUTH_USER, process.env.CASSANDRA_AUTH_PASS);
}
const client = new cassandra.Client(cassandraOpts);
const execAsync = Promise.promisify(exec);
const lookupDomain = 'SELECT * from zones WHERE origin = ?';
const nsRootDir = process.env.NS_ROOT_DIR || '.';
const nsZonesDir = process.env.NS_ZONES_DIR || (nsRootDir + '/zones.d');
const workerPool = process.env.HWTH_POOL || 'default';

const redisBackend = process.env['REDIS_HOST_' + workerPool] || process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env['REDIS_PORT_' + workerPool] || process.env.REDIS_PORT || 6379;

const bullProbe = pmxProbe.meter({ name: 'bull jobs per minute', sample: 60 });
const confChannel = 'refresh-config-' + workerPool;
const confQueue = new Queue('config-refresh-' + workerPool, { removeOnSuccess: true, isWorker: true, redis: { port: redisPort, host: redisBackend }});
const confSub = redis.createClient(redisPort, redisBackend, { db: process.env.REDIS_DBID || '0' });
const neighbors = require('../lib/advertiseNeighbors.js')('refresh-zones-' + workerPool + '-' + os.hostname());
const publisher = redis.createClient(redisPort, redisBackend, { db: process.env.REDIS_DBID || '0' });
const pubsubProbe = pmxProbe.meter({ name: 'pubsub events per minute', sample: 60 });
const zonesChannel = 'refresh-zones-' + workerPool;
const zonesQueue = new Queue('zones-refresh-' + workerPool, { removeOnSuccess: true, isWorker: true, redis: { port: redisPort, host: redisBackend }});
const zonesSub = redis.createClient(redisPort, redisBackend, { db: process.env.REDIS_DBID || '0' });

function pullDnssecKeys() {
    return new Promise((resolve, reject) => {
	    client.execute('SELECT * FROM zones')
		.then((resp) => {
			if (resp.rows !== undefined) {
			    let promises = [];
			    for (let j = 0; j < resp.rows.length; j++) {
				if (resp.rows[j].ksk !== undefined && resp.rows[j].ksk !== null && resp.rows[j].zsk !== undefined && resp.rows[j].zsk !== null) {
				    promises.push(dnssecUpdate(client, resp.rows[j]));
				}
			    }
			    Promise.all(promises)
				.then(() => {
					logger.info('done refreshing dnssec keys');
					resolve(true);
				    });
			}
		    })
		.catch((e) => {
			logger.error('failed listing zones refreshing dnssec configuration');
			logger.error(e);
			resolve(true);
		    });
	});
}

const reloadKeys = schedule.scheduleJob('43 * * * *', () => {
	if (neighbors.isElectedMaster() !== true) {
	    logger.info('skipping keys retrieval on slaves');
	    return true;
	}
	pullDnssecKeys()
	    .then(() => { return generateNsConf(client); })
	    .then(() => {
		    logger.info('refreshed ns configuration on schedule');
		})
	    .catch((e) => {
		    logger.error('failed refreshing ns configuration on schedule');
		    logger.error(e);
		});
    });

confSub.on('message', (chan, msg) => {
	if (neighbors.isElectedMaster() !== true) {
	    if (process.env.DEBUG) { logger.info('ignoring config re-generation on slaves'); }
	    return true;
	} else {
	    pullDnssecKeys()
		.then(() => { return generateNsConf(client); })
		.then(() => {
			let markFile = nsZonesDir + '/.hwth-serial';
			fs.writeFileSync(markFile, Date.now());
			logger.info('refreshed configuration on pubsub notification');
			pubsubProbe.mark();
		    })
		.catch((e) => {
			logger.error('failed refreshing configuration on pubsub notification');
			logger.error(e);
		    });
	}
    });
zonesSub.on('message', (chan, msg) => {
	if (neighbors.isElectedMaster() !== true) {
	    //neighbors only involves hosts with the same hostname - only need to run on one
	    if (process.env.DEBUG) { logger.info('ignoring zones refresh on non-master'); }
	    return true;
	}
	client.execute(lookupDomain, [ msg ])
	    .then((resp) => {
		    if (resp.rows !== undefined) {
			return new generateZone.GenerateZone(client, resp.rows[0], false)
			    .then(() => {
				    let markFile = nsZonesDir + '/.hwth-serial';
				    fs.writeFileSync(markFile, Date.now());
				    logger.info('refreshed ' + msg + ' on pubsub notification');
				    pubsubProbe.mark();
				})
			    .catch((e) => {
				    logger.error('failed refreshing ' + msg + ' on pubsub notification');
				    logger.error(e);
				});
		    } else {
			logger.info('failed querying cassandra about ' + msg);
		    }
		})
	    .catch((e) => {
		    logger.error('failed querying cassandra updating ' + msg);
		    logger.error(e);
		});
    });
confSub.subscribe(confChannel);
zonesSub.subscribe(zonesChannel);

confQueue.on('ready', () => { logger.info('conf queue ready'); });
confQueue.on('error', (e) => {
	logger.error('conf queue errored');
	logger.error(e);
	process.exit(1);
    });
confQueue.process((task, done) => {
	return pullDnssecKeys()
	    .then(() => { return generateNsConf(client); })
	    .then(() => {
		    logger.info('refreshed ns configuration on queue notification');
		    publisher.publish(confChannel, 'thestickoftruth');
		    bullProbe.mark();
		    done();
		})
	    .catch((e) => {
		    logger.error('failed refreshing configuration on queue notification');
		    logger.error(e);
		    done(); // should we send an alert?
		});
    });
zonesQueue.on('ready', () => { logger.info('zone queue ready'); });
zonesQueue.on('error', (e) => {
	logger.error('zones queue errored');
	logger.error(e);
	process.exit(1);
    });
zonesQueue.process((task, done) => {
	if (task.data.origin !== undefined) {
	    client.execute(lookupDomain, [ task.data.origin ])
		.then((dom) => {
		    if (dom !== undefined && dom.rows !== undefined && dom.rows[0] !== undefined) {
			return new generateZone.GenerateZone(client, dom.rows[0], true)
			    .then(() => {
				    if (task.data.confReload !== undefined) {
					logger.info('done refreshing ' + task.data.origin + ', reloading full configuration');
					confQueue.createJob({ dummy: true }).save();
				    } else {
					logger.info('done refreshing ' + task.data.origin + ', notifying pool');
					publisher.publish(zonesChannel, task.data.origin);
				    }
				    bullProbe.mark();
				    done();
				})
			    .catch((e) => {
				    logger.error('failed generating zone ' + task.data.origin);
				    logger.error(e);
				});
		    } else {
			logger.error('failed looking up domain ' + task.data.origin);
			done();
		    }
		})
	    .catch((e) => {
		    logger.error('failed querying cassandra refreshing zones');
		    logger.error(e);
		});
	} else {
	    logger.error('received invalid job on zones refresh queue');
	    if (process.env.NODE_ENV !== 'productiond') { logger.error(task.data); }
	}
    });

const checkStalledJobs = schedule.scheduleJob('* * * * *', () => {
	if (neighbors.isElectedMaster() !== true) {
	    logger.info('skipping stalled jobs check on slaves');
	    return true;
	}
	confQueue.checkStalledJobs((err, num) => {
		const sfx = ' stalled jobs in conf queue, ' + workerPool + ' pool';
		if (err) {
		    logger.error('failed checking for' + sfx);
		    logger.error(err);
		} else { logger.info('has ' + num + sfx); }
	    });
	zonesQueue.checkStalledJobs((err, num) => {
		const sfx = ' stalled jobs in zones queue, ' + workerPool + ' pool';
		if (err) {
		    logger.error('failed checking for' + sfx);
		    logger.error(err);
		} else { logger.info('has ' + num + sfx); }
	    });
    });

logger.info('waiting for neighbors');
execAsync('sleep 15')
    .then(() => {
	    if (neighbors.isElectedMaster() !== true) {
		logger.info('skipping keys retrieval on slaves');
		return true;
	    }
	    return pullDnssecKeys();
	})
    .then(() => {
	    if (neighbors.isElectedMaster() !== true) {
		logger.info('skipping configuration generation on slaves');
		return true;
	    }
	    return generateNsConf(client);
	})
    .then(() => {
	    logger.info('ready');
	    if (process.env.AIRBRAKE_ID !== undefined && process.env.AIRBRAKE_KEY !== undefined) {
		try {
		    let airbrake = require('airbrake').createClient(process.env.AIRBRAKE_ID, process.env.AIRBRAKE_KEY);
		    airbrake.handleExceptions();
		} catch(e) {
		    logger.info('WARNING: failed initializing airbrake');
		}
	    }
	})
    .catch((e) => {
	    logger.error(e);
	    process.exit(1);
	});
