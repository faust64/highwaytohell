const Promise = require('bluebird');
const Queue = require('bee-queue');
const cassandra = require('cassandra-driver');
const cst = require('../lib/cassandra.js');
const checkHealth = require('../lib/checkHealth.js');
const logger = require('../lib/logger.js')('check-health-manager');
const pmxProbe = require('pmx').probe();
const schedule = require('node-schedule');
const workerPool = process.env.HWTH_POOL || 'default';

const redisBackend = process.env['REDIS_HOST_' + workerPool] || process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env['REDIS_PORT_' + workerPool] || process.env.REDIS_PORT || 6379;
let cassandraOpts = {
	contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']),
	keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth'
    };
if (process.env.CASSANDRA_AUTH_USER && process.env.CASSANDRA_AUTH_PASS) {
    cassandraOpts.authProvider = new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_AUTH_USER, process.env.CASSANDRA_AUTH_PASS);
}
const beeProbe = pmxProbe.meter({ name: 'checks per mintute', sample: 60 });
const client = new cassandra.Client(cassandraOpts);
const checkQueue = new Queue('health-checks-' + workerPool, { removeOnSuccess: true, isWorker: true, redis: { port: redisPort, host: redisBackend }});
const checksLookup = 'SELECT * FROM checks WHERE nspool = ?';
const neighbors = require('../lib/advertiseNeighbors.js')('check-health-' + workerPool);
const notifyQueue = new Queue('outbound-notify-' + workerPool, { removeOnSuccess: true, isWorker: false, redis: { port: redisPort, host: redisBackend }});
const refreshQueue = new Queue('zones-refresh-' + workerPool, { removeOnSuccess: true, isWorker: false, redis: { port: redisPort, host: redisBackend }});

if (process.env.AIRBRAKE_ID !== undefined && process.env.AIRBRAKE_KEY !== undefined) {
    try {
	let airbrake = require('airbrake').createClient(process.env.AIRBRAKE_ID, process.env.AIRBRAKE_KEY);
	airbrake.handleExceptions();
    } catch(e) { logger.info('WARNING: failed initializing airbrake'); }
}

const cleanupChecks = schedule.scheduleJob('*/15 * * * *', () => {
	if (neighbors.isElectedMaster() !== true) {
	    if (process.env.DEBUG) { logger.info('ignoring cleanup on non-master'); }
	    return true;
	}
	let confLookup = "SELECT uuid, origin FROM checks WHERE nspool = '" + workerPool + "'";
	let domainsLookup = "SELECT origin FROM zones WHERE nspool = '" + workerPool + "'";
	let hasDomains = [];
	client.execute(domainsLookup, [], cst.readConsistency())
	    .then((doms) => {
		    client.execute(confLookup, [], cst.readConsistency())
			.then((confs) => {
				for (let k = 0; k < doms.length; k++) { hasDomains.push(doms[k].origin); }
				logger.info('collected ' + hasDomains.length + ' domains, now starting to purge orphan health checks');
				if (process.env.DEBUG) { logger.info(hasDomains); }
				let promises = [];
				for (let k = 0; k < confs.length; k++) {
				    if (hasDomains.indexOf(confs[k].origin) >= 0) { continue; }
				    else {
					let dropCheck = "DELETE FROM checks WHERE uuid = '" + confs[k].uuid + "' AND origin = '" + confs[k].origin + "'";
					let dropHistory = "DELETE FROM checkhistory WHERE uuid = '" + confs[k].uuid + "'";
					promises.push(client.execute(dropCheck, [], cst.writeConsistency())
							.then((resp) => {
								client.execute(dropHistory, [], cst.writeConsistency())
								    .then((dresp) => { logger.info('purged orphan ' + confs[k].uuid); })
								    .catch((e) => {
									    logger.error('failed purging orphan history ' + confs[k].uuid);
									    logger.error(e);
									});
							    })
							.catch((e) => {
								logger.error('failed purging orphan ' + confs[k].uuid);
								logger.error(e);
							    }));
				    }
				}
				if (promises.length > 0) {
				    Promise.all(promises)
					.then((ret) => { logger.info('done purging orphan checks'); })
					.catch((e) => {
						logger.error('errored purging orphan checks');
						logger.error(e);
					    });
				} else { logger.info('no orphan checks needing purge'); }
			    })
			.catch((e) => {
				logger.error('failed querying cassandra for list of checks');
				logger.error(e);
			    });
		})
	    .catch((e) => {
		    logger.error('failed querying cassandra for list of domains');
		    logger.error(e);
		});
    });

const cleanupLogs = schedule.scheduleJob('42 * * * *', () => {
	if (neighbors.isElectedMaster() !== true) {
	    if (process.env.DEBUG) { logger.info('ignoring cleanup on non-master'); }
	    return true;
	}
	let evictBefore = (Date.now() - 3600000);
	client.execute(checksLookup, [ workerPool ], cst.readConsistency())
	    .then(result => {
		    if (result.rows !== undefined) {
			let lookupPromise = [];
			result.rows.forEach(check => {
				lookupPromise.push(new Promise ((resolve, reject) => {
					let lookup = "SELECT when FROM checkhistory WHERE uuid = '" + check.uuid + "' ORDER BY when asc";
					client.execute(lookup, [], cst.readConsistency())
					    .then(history => {
						    if (history.rows !== undefined) {
							let commands = [];
							history.rows.forEach(row => {
								if (parseInt(row.when) < evictBefore) {
								    commands.push({ query: "DELETE FROM checkhistory WHERE uuid = '" + check.uuid + "' AND when = '" + row.when + "'" });
								}
							    });
							if (commands.length > 0) {
							    client.batch(commands, cst.writeConsistency(), function(err) {
								    if (err) {
									logger.info('failed purging older records for check UUID ' + check.uuid);
									resolve(true);
								    } else {
									logger.info('purged older records for check UUID ' + check.uuid);
									resolve(true);
								    }
								});
							} else { resolve(true); }
						    } else {
							logger.info('failed querying health check history for check UUID ' + check.uuid);
							resolve(true);
						    }
						})
					    .catch((e) => {
						    logger.error('failed querying cassandra for health history of check UUID ' + check.uuid);
						    resolve(true);
						});
				    }));
			    });
			Promise.all(lookupPromise)
			    .then(() => { logger.info('done cleaning up'); });
		    } else { logger.info('failed looking up health checks'); }
		})
	    .catch((e) => { logger.error('failed querying cassandra for health checks'); });
    });

checkQueue.process((task, done) => {
	if (task.data.uuid !== undefined) {
	    return new checkHealth.CheckHealth(client, task.data)
		.then(() => {
			beeProbe.mark();
			notifyQueue.createJob({ what: 'healthcheck', checkid: task.data.uuid }).save();
			logger.info('scheduling notification conditions evaluations checks');
			let checkCond = "SELECT * FROM checks WHERE uuid = '" + task.data.uuid + "'";
			client.execute(checkCond, [], cst.readConsistency())
			    .then(conditions => {
				    if (conditions.rows !== undefined) {
					if (conditions.rows.length > 0) {
					    let requireHealthy = conditions.rows[0].requirehealthy,
						requireUnhealthy = conditions.rows[0].requireunhealthy,
						maxLimit = (requireHealthy > requireUnhealthy ? requireHealthy : requireUnhealthy) + 1,
						lookup = "SELECT value FROM checkhistory WHERE uuid = '" + task.data.uuid + "' ORDER BY when desc LIMIT " + maxLimit,
						origin = conditions.rows[0].origin;
					    client.execute(lookup, [], cst.readConsistency())
						.then((resp) => {
							if (resp.rows !== undefined) {
							    if (resp.rows.length > 0) {
								let count = 0, countb = 0, recHealthy = null, recPrevious = null;
								for (let k = 0; k < resp.rows.length && (recHealthy === null || recPrevious === null); k++) {
								    if (resp.rows[k].value === true) { if (k !== 0) { countb++; } if ((k + 1) < resp.rows.length) { count++; } }
								    if ((k + 1) === requireUnhealthy && count === 0) { recHealthy = false; }
								    else if (k === requireUnhealthy && countb === 0) { recPrevious = false; }
								    if (recHealthy === null && (k + 1) === requireHealthy && count >= requireHealthy) { recHealthy = true; }
								    else if (recPrevious === null && k === requireHealthy && countb >= requireHealthy) { recPrevious = true; }
								}
								if (recHealthy === null) { recHealthy = false; }
								if (recPrevious === null) { recPrevious = false; }
								if (recHealthy !== recPrevious) {
								    let lookupRecords = "SELECT origin FROM records WHERE healthcheckid = '" + task.data.uuid + "'";
								    client.execute(lookupRecords, [], cst.readConsistency())
									.then((items) => {
										let domainMatch = false;
										if (items.rows !== undefined) {
										    for (let k = 0; k < items.rows.length; k++) {
											if (items.rows[k].origin === origin) { domainMatch = true; break ; }
										    }
										}
										if (domainMatch !== false) {
										    let lookupDomain = "SELECT * from zones WHERE origin = '" + origin + "'";
										    client.execute(lookupDomain, [], cst.readConsistency())
											.then((resp) => {
												if (resp.rows !== undefined && resp.rows.length > 0 && resp.rows[0].origin) {
												    logger.info('should schedule zone refresh for ' + origin);
												    refreshQueue.createJob(resp.rows[0]).save();
												} else { logger.info('unable to lookup domain refreshing zone on behalf of ' + task.data.uuid); }
												done();
											    })
											.catch((e) => {
												logger.error('unable to query cassandra refreshing zone on behalf of ' + task.data.uuid);
												logger.error(e);
												done();
											    });
										} else {
										    logger.info('no records depending on ' + task.data.uuid);
										    done();
										}
									    })
									.catch((e) => {
										logger.error('unable to query cassandra resolving records depending on ' + task.data.uuid);
										logger.error(e);
										done();
									    });
								} else { if (process.env.DEBUG) { logger.info('no refresh needed'); } done(); }
							    } else { logger.info('no history for check ID:' + task.data.uuid); done(); }
							} else { logger.info('invalid response from cassandra checking changes in ' + task.data.uuid); done(); }
						    })
						.catch((e) => {
							logger.error('failed looking up last data from history regarding ' + task.data.uuid);
							logger.error(e);
							done();
						    });
					} else { logger.info('settings for health check ' + task.data.uuid + ' not found'); done(); }
				    } else { logger.info('failed listing settings for health check ' + task.data.uuid); done(); }
				})
			    .catch((e) => {
				    logger.error('failed querying cassandra for health check ' + task.data.uuid);
				    logger.error(e);
				    done();
				});
		    });
	}
    });

const refresh = schedule.scheduleJob('*/15 * * * * *', () => {
	if (neighbors.isElectedMaster() !== true) {
	    if (process.env.DEBUG) { logger.info('ignoring refreshes scheduling on non-master'); }
	    return true;
	}
	let now = Math.round(Date.now() / 1000) * 1000;
	client.execute(checksLookup, [ workerPool ], cst.readConsistency())
	    .then(result => {
		    if (result.rows !== undefined) {
			let checkPromise = [];
			result.rows.forEach(check => {
				checkPromise.push(new Promise ((resolve, reject) => {
					let ttl = check.ttl || 60;
					let lookup = "SELECT when FROM checkhistory WHERE uuid = '" + check.uuid + "' ORDER BY when desc LIMIT 1";
					client.execute(lookup, [], cst.readConsistency())
					    .then(lastChecked => {
						    let doCheck = false;
						    if (lastChecked.rows !== undefined) {
							if (lastChecked.rows.length === 0) {
							    doCheck = true;
							} else if (parseInt(lastChecked.rows[0].when) + ((ttl - 1) * 1000) <= now) {
							    doCheck = true;
							} else if (process.env.DEBUG) {
							    logger.info('last checked on ' + lastChecked.rows[0].when);
							    logger.info('last check on ' + (parseInt(lastChecked.rows[0].when) + (ttl * 1000)));
							    logger.info('now is ' + now);
							}
						    } else { doCheck = true; }
						    if (doCheck) {
							if (process.env.DEBUG) { logger.info('scheduling check ' + check.uuid); }
							return checkQueue.createJob(check).save();
						    } else if (process.env.DEBUG) {
							logger.info('should not check ' + check.uuid);
						    }
						})
					    .then(() => { resolve(true); })
					    .catch((e) => {
						    logger.error('failed looking up checks for ' + check.uuid);
						    logger.error(e);
						    resolve(true);
						});
				    }));
			    });
			Promise.all(checkPromise)
			    .then(() => { logger.info('done scheduling health checks'); });
		    } else { logger.info('failed listing health checks, cassandra returned' + JSON.stringify(result)); }
		})
	    .catch((e) => { logger.error('failed looking up health checks'); });
    });
