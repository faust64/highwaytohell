const QRCode = require('qrcode');
const Mustache = require('mustache');
const apiRoutes = require('../api/index.js');
const authValidation = require('./authValidation.js');
const cmdValidation = require('./commandValidation.js');
const fs = require('fs');
const logger = require('./logger.js')('api-router');
const pmxProbe = require('pmx').probe();
const schedule = require('node-schedule');

const getProbe = pmxProbe.meter({ name: 'GET per minute', sample: 60 });
const defaultPool = process.env.HWTH_POOL || 'default';
const postProbe = pmxProbe.meter({ name: 'POST per minute', sample: 60 });
const loadDirectory = function loadDirectory(dirPath, target) {
	fs.readdirSync(dirPath).forEach((file) => {
		if (file.match(/\w+\.j2$/)) {
		    target[file.replace(/\.j2/, '')] = fs.readFileSync(dirPath + '/' + file).toString();
		}
	    });
    };
let tag = 'alpha', templates = [];
if (fs.exists('./revision')) {
    try {
	tag = fs.readFileSync('./revision');
    } catch (e) {
	logger.info('failed reading revision, assuming alpha')
	tag = 'alpha';
    }
}
try {
    loadDirectory('./templates', templates);
} catch (e) {
    logger.error('failed loading templates - browser accesses denied');
}

module.exports = (app, cassandra, confQueues, zonesQueues) => {
	this._globalHealth = false;
	let self = this;
	this._healthJob = schedule.scheduleJob('*/20 * * * *', () => {
		cassandra.execute('SELECT * FROM system.local')
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				self._globalHealth = true;
			    } else {
				self._globalHealth = false;
			    }
			})
		    .catch((e) => {
			    self._globalHealth = false;
			});
	    });
	this._getPool = function(domainName, userId) {
		return new Promise ((resolve, reject) => {
			let lookupPool = "SELECT nspool FROM zones WHERE origin = '" + domainName + "' AND idowner = '" + userId + "'";
			cassandra.execute(lookupPool)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				resolve(resp.rows[0].nspool);
			    } else {
				logger.error('failed looking up pool for ' + domainName);
				logger.error(resp.rows);
				reject('failed looking up pool for ' + domainName);
			    }
			})
		    .catch((e) => {
			    logger.error('failed querying cassandra looking up pool for ' + domainName);
			    logger.error(e);
			    reject('failed querying cassandra looking up pool for ' + domainName);
			});
		    });
	    };

	app.get('/', (req, res) => {
		getProbe.mark();
		res.send('highwaytohell API gateway ' + tag);
	    });

	app.get('/ping', (req, res) => {
		getProbe.mark();
		if (this._globalHealth === true) {
		    res.send('OK');
		} else {
		    res.status(500).send('backend error');
		}
	    });

	app.get('/login/2fa', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/login/2fa', (req, res) => {
		postProbe.mark();
		let assumesId = req.body.userid;
		let code2fa = req.body.confirmation;
		let token2fa = req.body.token;
		cmdValidation(req, res, '2fa-login')
		    .then((params) => {
			    apiRoutes.check2fa(cassandra, req, assumesId, code2fa, token2fa)
				.then((userobj) => {
					req.session.userid = assumesId;
					req.session.username = userobj.username;
					req.session.email = userobj.email;
					logger.info('2fa-authenticated ' + req.session.userid);
					res.redirect('/domains');
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input on 2FA login from ' + assumesId);
			    logger.error(e);
			    res.redirect(301, '/login');
			});
	    });
	app.post('/login', (req, res) => {
		postProbe.mark();
		let seenId = req.body.emailaddress || false,
		    userPw = req.body.userpw || false;
		cmdValidation(req, res, 'login')
		    .then((params) => {
			    apiRoutes.login(cassandra, req, seenId, userPw)
				.then((resp) => {
					req.session.userid = resp.uuid;
					req.session.username = resp.username;
					req.session.email = seenId;
					logger.info('authenticated ' + req.session.userid);
					res.redirect('/domains');
				}).catch((e) => {
					if (e.reason !== undefined && e.reason === '2FA') {
					    apiRoutes.login2fa(seenId)
						.then((secret) => {
							let output = Mustache.render(templates['login2fa'], { userid: e.userid, secret: secret });
							res.send(output);
						    })
						.catch((de) => {
							logger.error('failed serving 2FA user with second-factor token');
							logger.error(de);
							res.redirect(301, '/login');
						    });
					} else {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e);
					    res.redirect(301, '/login');
					}
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input on login from ' + seenId);
			    logger.error(e);
			    res.redirect(301, '/login');
			});
	    });
	app.get('/login', (req, res) => {
		getProbe.mark();
	    /*
	     * we should have client browser hash its passphrase, somehow
	     */
		let output = Mustache.render(templates['login'], {});
		res.send(output);
	    });
	app.get('/logout', (req, res) => {
		getProbe.mark();
		try {
		    req.session.userid = false;
		    req.session.username = false;
		    req.session.email = false;
		    req.session.destroy();
		    delete req.session;
		    res.redirect(301, '/login');
		} catch(e) {
		    res.redirect(301, '/login');
		}
	    });

	app.post('/domains', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'list-domains-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'zones:ro')
				.then((userId) => {
					apiRoutes.listZones(cassandra, userId, null)
					    .then((zones) => {
						    res.send(zones);
						})
					    .catch((e) => {
						    logger.error('failed listing zones for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing domains');
			    logger.error(e);
			    res.status(400).send('invalid input listing domains');
			});
	    });
	app.get('/domains', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'list-domains-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'zones:ro')
				.then((userId) => {
					let renderWith = { username: req.session.username, records: [] };
					apiRoutes.listZones(cassandra, req.session.userid, false)
					    .then((zones) => {
						    for (let k = 0; k < zones.length; k++) {
							let hasDnssec = (zones[k].ksk !== undefined && zones[k].ksk !== null && zones[k].zsk !== undefined && zones[k].zsk !== null) ? 'is enabled' : 'is not configured';
							renderWith.records.push({ origin: zones[k].origin, serial: zones[k].serial, hasdnssec: hasDnssec, nspool: zones[k].nspool });
						    }
						    let output = Mustache.render(templates['listDomains'], renderWith);
						    res.send(output);
						})
					    .catch((e) => {
						    logger.error('failed listing domains for ' + userId);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing domains';
						    let output = Mustache.render(templates['backendError'], renderWith);
						    res.send(output);
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing domains');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input listing domains' };
				let output = Mustache.render(templates['backendError'], renderWith);
				res.send(output);
			    } else {
				res.status(400).send('invalid input listing domains');
			    }
			});
	    });
	app.get('/domains/:domainName/add', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/domains/:domainName/add', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'adddel-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:rw')
				.then((userId) => {
					apiRoutes.addZone(cassandra, userId, domainName)
					    .then((zone) => {
						    if (confQueues[defaultPool] !== undefined) {
							logger.info('notifying refresh workers to reload ' + domainName);
							confQueues[defaultPool].add({ origin: domainName });
						    } else { logger.info('no queue running for ' + defaultPool + ' -- 1 + 1 = 3'); }
						    if (req.session.username !== undefined) { res.redirect('/domains'); }
						    else { res.send(zone); }
						})
					    .catch((e) => {
						    logger.error('failed adding zone ' + domainName + ' for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.acualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input adding domain');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input adding domains' };
				let output = Mustache.render(templates['backendError'], renderWith);
				res.send(output);
			    } else {
				res.status(400).send('invalid input adding domains');
			    }
			});
	    });
	app.get('/domains/:domainName/del', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/domains/:domainName/del', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'adddel-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:rw')
				.then((userId) => {
					self._getPool(domainName, userId)
					    .then((nsPool) => {
						    apiRoutes.delZone(cassandra, userId, domainName)
							.then((zone) => {
								if (confQueues[nsPool] !== undefined) {
								    logger.info('notifying refresh workers to reload ' + domainName);
								    confQueues[nsPool].add({ origin: domainName });
								} else { logger.info('no queue running for ' + nsPool + ' -- restart REQUIRED!'); }
								if (req.session.username !== undefined) { res.redirect('/domains'); }
								else { res.send(zone); }
							    })
							.catch((e) => {
								logger.error('failed dropping zone ' + domainName + ' for ' + userId);
								logger.error(e);
								res.status(500).send('backend error');
							    });
						})
					    .catch((e) => {
						    logger.error('failed refresh conf removing domain ' + domainName + ' for ' + userId);
						    logger.error(e);
						    apiRoutes.delZone(cassandra, userId, domainName)
							.then((zone) => {
								if (req.session.username !== undefined) { res.redirect('/domains'); }
								else { res.send(zone); }
							    })
							.catch((e) => {
								logger.error('failed dropping zone ' + domainName + ' for ' + userId);
								logger.error(e);
								res.status(500).send('backend error');
							    });
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user');
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input dropping domain');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input dropping domains' };
				let output = Mustache.render(templates['backendError'], renderWith);
				res.send(output);
			    } else {
				res.status(400).send('invalid input dropping domain');
			    }
			});
	    });
	app.get('/domains/:domainName/disablednssec', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/domains/:domainName/disablednssec', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'adddel-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:rw')
				.then((userId) => {
					apiRoutes.disableDnssec(cassandra, domainName, userId)
					    .then((dnssec) => {
						    self._getPool(domainName, userId)
							.then((nsPool) => {
								if (confQueues[nsPool] !== undefined) {
								    logger.info('notifying refresh workers to reload ' + domainName);
								    confQueues[nsPool].add({ origin: domainName });
								} else { logger.info('no queue running for ' + nsPool + ' -- restart REQUIRED!'); }
								if (req.session.username !== undefined) { res.redirect('/domains/' + domainName); }
								else { res.send(dnssec); }
							    })
							.catch((e) => {
								logger.error('failed refresh zones disabling dnssec on ' + domainName + ' for ' + userId);
								logger.error(e);
								if (req.session.username !== undefined) { res.redirect('/domains/' + domainName); }
								else { res.send(dnssec); }
							    });
						})
					    .catch((e) => {
						    logger.error('failed disabling dnssec on ' + domainName + ' for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input disabling dnssec');
			    logger.error(e);
			    res.status(400).send('invalid input disabling dnssec');
			});
	    });
	app.get('/domains/:domainName/enablednssec', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/domains/:domainName/enablednssec', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'adddel-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:rw')
				.then((userId) => {
					apiRoutes.enableDnssec(cassandra, domainName, userId)
					    .then((dnssec) => {
						    self._getPool(domainName, userId)
							.then((nsPool) => {
								if (confQueues[nsPool] !== undefined) {
								    logger.info('notifying refresh workers to reload ' + domainName);
								    confQueues[nsPool].add({ origin: domainName });
								} else { logger.info('no queue running for ' + nsPool + ' -- restart REQUIRED!'); }
								if (req.session.username !== undefined) { res.redirect('/domains/' + domainName); }
								else { res.send(dnssec); }
							    })
							.catch((e) => {
								logger.error('failed looking up pool to refresh');
								logger.error(e);
								if (req.session.username !== undefined) { res.redirect('/domains/' + domainName); }
								else { res.send(dnssec); }
							    })
						})
					    .catch((e) => {
						    logger.error('failed enabling dnssec on ' + domainName + ' for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input enabling dnssec');
			    logger.error(e);
			    res.status(400).send('invalid input enabling dnssec');
			});
	    });
	app.post('/domains/:domainName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:ro')
				.then((userId) => {
					apiRoutes.getZone(cassandra, userId, domainName)
					    .then((zone) => {
						    res.send(zone);
						})
					    .catch((e) => {
						    logger.error('failed fetching zone ' + domainName + ' for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching domain data');
			    logger.error(e);
			    res.status(400).send('invalid input fetching domain data');
			});
	    });
	app.get('/domains/:domainName', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'adddel-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:ro')
				.then((userId) => {
					let renderWith = { username: req.session.username, domain: domainName };
					apiRoutes.getZone(cassandra, req.session.userid, domainName)
					    .then((zone) => {
						    let dnssecdata = "<form method=POST action='/domains/" + domainName + "/";
						    if (zone.ksk !== undefined && zone.ksk !== false && zone.ksk !== null && zone.zsk !== undefined && zone.zsk !== false && zone.zsk !== null) {
							dnssecdata += "disablednssec'><div class='good'>Enabled</div><br/>";
							apiRoutes.getZoneDS(cassandra, req.session.userid, domainName)
							    .then((ds) => {
								    if (ds.ds !== undefined) {
									dnssecdata += "DS KEYs:<br/><div class='dskeys'>" + ds.ds.toString().replace(/\n/g, '<br/>') + "</div>";
								    } else {
									dnssecdata += "Unable to find DS KEYs yet - if problem persist, try adding a record or contact support<br/>";
								    }
								    dnssecdata += "<input type='submit' value='Disable DNSSEC'/></form>";
								    renderWith['dnssec'] = dnssecdata;
								    renderWith['nspool'] = zone.nspool;
								    renderWith['origin'] = zone.origin;
								    renderWith['serial'] = zone.serial;
								    let output = Mustache.render(templates['getDomain'], renderWith);
								    res.send(output);
								})
							    .catch((e) => {
								    logger.error('failed looking up DS record');
								    logger.error(e);
								    dnssecdata += "'>Failed looking up DS records, please try again later</form>";
								    renderWith['dnssec'] = dnssecdata;
								    renderWith['nspool'] = zone.nspool;
								    renderWith['origin'] = zone.origin;
								    renderWith['serial'] = zone.serial;
								    let output = Mustache.render(templates['getDomain'], renderWith);
								    res.send(output);
								});
						    } else {
							dnssecdata += "enablednssec'><div class='bad'>Disabled</div><br/><input type='submit' value='Enable DNSSEC'/></form>";
							renderWith['dnssec'] = dnssecdata;
							renderWith['nspool'] = zone.nspool;
							renderWith['origin'] = zone.origin;
							renderWith['serial'] = zone.serial;
							let output = Mustache.render(templates['getDomain'], renderWith);
							res.send(output);
						    }
						})
					    .catch((e) => {
						    logger.error('failed fetching ' + domainName + ' zone settings ' + req.session.userid);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed fetching domains';
						    let output = Mustache.render(templates['backendError'], renderWith);
						    res.send(output);
						})
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching domain');
			    logger.error(e);
			    res.status(400).send('invalid input fetching domain');
			});
	    });

	app.get('/healthhistory/:domainName/get/:checkId', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'get-healthcheck-get')
		    .then((params) => {
			    let domainName = params.domainName;
			    let checkId = params.checkId;
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let renderWith = { username: req.session.username, domain: domainName, checkid: checkId, records: [] };
					apiRoutes.listHealthCheckHistory(cassandra, checkId)
					    .then((history) => {
						    for (let k = 0; k < history.length; k++) {
							let whenString = new Date(Math.round(history[k].when)).toISOString();
							let valueString = (history[k].value === true) ? 'healthy' : 'failed';
							renderWith.records.push({ when: whenString, value: valueString });
						    }
						    let output = Mustache.render(templates['listHealthHistory'], renderWith);
						    res.send(output);
						})
					    .catch((e) => {
						    logger.error('failed fetching health history for ' + userId);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed fetching healthcheck history';
						    let output = Mustache.render(templates['backendError'], renderWith);
						    res.send(output);
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing healthcheck history');
			    logger.error(e);
			    res.status(400).send('invalid input listing healthcheck history');
			});
	    });
	app.post('/healthhistory/:domainName/get/:checkId', (req, res) => {
		postProbe.mark();
		let checkId = req.params.checkId || false;
		cmdValidation(req, res, 'get-healthcheck-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					apiRoutes.listHealthCheckHistory(cassandra, checkId)
					    .then((history) => {
						    res.send(history);
						})
					    .catch((e) => {
						    logger.error('failed listing checks history for ' + userId + ' #' + checkId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing healthcheck history');
			    logger.error(e);
			    res.status(400).send('invalid input listing healthcheck history');
			});
	    });

	app.get('/healthchecks/:domainName/add', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/healthchecks/:domainName/add', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-healthcheck')
		    .then((params) => {
			    let domainName = params.domainName || false;
			    authValidation(cassandra, req, 'checks:rw')
				.then((userId) => {
					let checkObject = {
						invert: params.checkInvert || false,
						target: params.checkTarget || false,
						type: params.checkType || 'icmp',
						headers: params.checkHeaders || false,
						healthyThreshold: params.checkHealthy || 3,
						match: params.checkMatch || false,
						unhealthyThreshold: params.checkUnhealthy || 2,
						uuid: false
					    };
					apiRoutes.addHealthCheck(cassandra, domainName, checkObject)
					    .then((check) => {
						    if (req.session.username !== undefined) {
							res.redirect('/healthchecks/' + domainName);
						    } else {
							res.send(check);
						    }
						})
					    .catch((e) => {
						    logger.error('failed adding health check for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input adding health check');
			    logger.error(e);
			    res.status(400).send('invalid input adding health check');
			});
	    });
	app.get('/healthchecks/:domainName/del/:checkId', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/healthchecks/:domainName/del/:checkId', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'del-healthcheck')
		    .then((params) => {
			    let domainName = params.domainName;
			    let checkId = params.checkId;
			    authValidation(cassandra, req, 'checks:rw')
				.then((userId) => {
					let checkObject = { uuid: checkId, origin: domainName };
					apiRoutes.delHealthCheck(cassandra, userId, checkObject)
					    .then((check) => {
						    if (req.session.username !== undefined) {
							res.redirect('/healthchecks/' + domainName);
						    } else {
							res.send(check);
						    }
						})
					    .catch((e) => {
						    logger.error('failed dropping health check for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input dropping health check');
			    logger.error(e);
			    res.status(400).send('invalid input dropping health check');
			});
	    });
	app.get('/healthchecks/:domainName/edit/:checkId', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/healthchecks/:domainName/edit/:checkId', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'edit-healthcheck')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'checks:rw')
				.then((userId) => {
					let checkObject = {
						invert: params.checkInvert || false,
						target: params.checkTarget || false,
						type: params.checkType || 'icmp',
						headers: params.checkHeaders || false,
						healthyThreshold: params.checkHealthy || 3,
						match: params.checkMatch || false,
						unhealthyThreshold: params.checkUnhealthy || 2,
						uuid: params.checkId
					    };
					apiRoutes.addHealthCheck(cassandra, domainName, checkObject)
					    .then((check) => {
						    if (req.session.username !== undefined) {
							res.redirect('/healthchecks/' + domainName);
						    } else {
							res.send(check);
						    }
						})
					    .catch((e) => {
						    logger.error('failed updating health check for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + param.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input editing health check');
			    logger.error(e);
			    res.status(400).send('invalid input editing health check');
			});
	    });
	app.get('/healthchecks/:domainName/get/:checkId', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'get-healthcheck-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let domainName = params.domainName;
					let checkId = params.checkId;
					apiRoutes.getHealthCheck(cassandra, domainName, checkId)
					    .then((hc) => {
						    let invert = 'no', match = 'non-error HTTP code', headers = 'none', headersstr = '', target = hc.target;
						    if (hc.invert !== undefined && hc.invert !== false) { invert = 'yes'; }
						    if (hc.match !== undefined && hc.match !== false) { match = hc.match; }
						    if (hc.headers !== undefined && hc.headers !== false) { headers = 'Host: ' + hc.headers; headersstr = hc.headers; }
						    if (hc.type === 'http' && hc.target !== undefined && hc.target !== false) { target = "<a href='" + hc.target + "' target='_blank'>" + hc.target + "</a>"; }
						    let renderWith = { username: req.session.username, domain: domainName, checkid: checkId, invert: invert,
							    match: match, headers: headers, headersstr: headersstr, type: hc.type, target: target, targetstr: hc.target,
							    rqhealthy: hc.requirehealthy, rqunhealthy: rq.requireunhealthy };
						    let output = Mustache.render(templates['getHealthCheck'], renderWith);
						    res.send(output);
						})
					    .catch((e) => {
						    logger.error('failed fetching healthcheck settings ' + req.session.userid);
						    logger.error(e);
						    let renderWith = { username: req.session.username , errormsg: 'failed fetching healthcheck settings' };
						    let output = Mustache.render(templates['backendError'], renderWith);
						    res.send(output);
						})
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching health check');
			    logger.error(e);
			    res.status(400).send('invalid input fetching health check');
			});
	    });
	app.post('/healthchecks/:domainName/get/:checkId', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-healthcheck-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let domainName = req.params.domainName || 'example.com';
					let checkId = req.params.checkId || false;
					apiRoutes.getHealthCheck(cassandra, domainName, checkId)
					    .then((check) => {
						    res.send(check);
						})
					    .catch((e) => {
						    logger.error('failed fetching health check ' + checkId + ' for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching health check');
			    logger.error(e);
			    res.status(400).send('invalid input fetching health check');
			});
	    });
	app.get('/healthchecks/:domainName', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'get-healthchecks-get')
		    .then((params) => {
			    let domainName = params.domainName || 'example.com';
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let renderWith = { username: req.session.username, domain: domainName, records: [] };
					apiRoutes.listHealthChecks(cassandra, domainName)
					    .then((checks) => {
						    for (let k = 0; k < checks.length; k++) {
							let invert = 'no', match = 'non-error HTTP code', headers = 'none', target = checks[k].target, headersstr = '';
							if (checks[k].invert !== undefined && checks[k].invert !== false) { invert = 'yes'; }
							if (checks[k].match !== undefined && checks[k].match !== false) { match = checks[k].match; }
							if (checks[k].headers !== undefined && checks[k].headers !== false) { headers = 'Host: ' + checks[k].headers; headersstr = checks[k].headers; }
							if (checks[k].type === 'http' && checks[k].target !== undefined && checks[k].target !== false) { target = "<a href='" + checks[k].target + "' target='_blank'>" + checks[k].target + "</a>"; }
							renderWith.records.push({ checkid: checks[k].uuid, type: checks[k].type, invert: invert,
								headers: headers, target: target, match: match, nspool: checks[k].nspool, headersstr: headersstr,
								reqhealthy: checks[k].requirehealthy, requnhealthy: checks[k].requireunhealthy, targetstr: checks[k].target });
						    }
						    let output = Mustache.render(templates['listHealthChecks'], renderWith);
						    res.send(output);
						})
					    .catch((e) => {
						    logger.error('failed listing checks for ' + req.session.userid);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing healthcheck';
						    let output = Mustache.render(templates['backendError'], renderWith);
						    res.send(output);
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing health checks');
			    logger.error(e);
			    res.status(400).send('invalid input listing health checks');
			});
	    });
	app.post('/healthchecks/:domainName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-healthchecks-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let domainName = req.params.domainName || false;
					apiRoutes.listHealthChecks(cassandra, domainName)
					    .then((checks) => {
						    res.send(checks);
						})
					    .catch((e) => {
						    logger.error('failed listing health checks for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing health checks');
			    logger.error(e);
			    res.status(400).send('invalid input listing health checks');
			});
	    });

	app.get('/records/:domainName/add/:recordName', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/records/:domainName/add/:recordName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-record')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:rw')
				.then((userId) => {
					let domainName = params.domainName;
					let recordObject = {
						healthCheckId: params.recordCheckId || false,
						name: params.recordName || false,
						priority: params.recordPriority || 10,
						setId: params.setId || params.recordName,
						target: params.recordTarget || false,
						ttl: params.recordTtl || 3600,
						type: params.recordType || 'A',
					    };
					apiRoutes.addRecord(cassandra, domainName, recordObject)
					    .then((record) => {
						    self._getPool(domainName, userId)
							.then((nsPool) => {
								if (zonesQueues[nsPool] !== undefined) {
								    logger.info('notifying refresh workers to reload ' + domainName);
								    zonesQueues[nsPool].add({ origin: domainName });
								} else { logger.info('no queue running for ' + nsPool + ' -- restart REQUIRED!'); }
								if (req.session.username !== undefined) { res.redirect('/records/' + domainName); }
								else { res.send(record); }
							    })
							.catch((e) => {
								logger.error('failed looking up pool to refresh');
								logger.error(e);
								if (req.session.username !== undefined) { res.redirect('/records/' + domainName); }
								else { res.send(record); }
							    });
						})
					    .catch((e) => {
						    logger.error('failed adding record ' + params.recordName + ' for ' + userId + ' in ' + domainName);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: e };
							let output = Mustache.render(templates['backendError'], renderWith);
							res.send(output);
						    } else { res.status(500).send('backend error'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input adding record');
			    logger.error(e);
			    res.status(400).send('invalid input adding record');
			});
	    });
	app.get('/records/:domainName/del/:recordName', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/records/:domainName/del/:recordName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'del-record')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:rw')
				.then((userId) => {
					let domainName = params.domainName;
					let recordObject = {
						origin: domainName,
						name: params.recordName || false,
						setId: params.setId || params.recordName,
						type: params.recordType || 'A'
					    };
					apiRoutes.delRecord(cassandra, userId, recordObject)
					    .then((record) => {
						    self._getPool(domainName, userId)
							.then((nsPool) => {
								if (zonesQueues[nsPool] !== undefined) {
								    logger.info('notifying refresh workers to reload ' + domainName);
								    zonesQueues[nsPool].add({ origin: domainName });
								} else { logger.info('no queue running for ' + nsPool + ' -- restart REQUIRED!'); }
								if (req.session.username !== undefined) { res.redirect('/records/' + domainName); }
								else { res.send(record); }
							    })
							.catch((e) => {
								logger.error('failed looking up pool to refresh');
								logger.error(e);
								if (req.session.username !== undefined) { res.redirect('/records/' + domainName); }
								else { res.send(record); }
							    });
						})
					    .catch((e) => {
						    logger.error('failed dropping record ' + recordObject.name + ' for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input dropping record');
			    logger.error(e);
			    res.status(400).send('invalid input dropping record');
			});
	    });
	app.get('/records/:domainName/edit/:recordName', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/records/:domainName/edit/:recordName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-record')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'records:rw')
				.then((userId) => {
					let recordObject = {
						healthCheckId: params.recordCheckId || false,
						name: params.recordName || false,
						priority: params.recordPriority || 10,
						setId: params.setId || params.recordName,
						target: params.recordTarget || false,
						ttl: params.recordTtl || 3600,
						type: params.recordType || 'A',
					    };
					apiRoutes.addRecord(cassandra, domainName, recordObject)
					    .then((record) => {
						    self._getPool(domainName, userId)
							.then((nsPool) => {
								if (zonesQueues[nsPool] !== undefined) {
								    logger.info('notifying refresh workers to reload ' + domainName);
								    zonesQueues[nsPool].add({ origin: domainName });
								} else { logger.info('no queue running for ' + nsPool + ' -- restart REQUIRED!'); }
								if (req.session.username !== undefined) { res.redirect('/records/' + domainName); }
								else { res.send(record); }
							    })
							.catch((e) => {
								logger.error('failed looking up pool to refresh');
								logger.error(e);
								if (req.session.username !== undefined) { res.redirect('/records/' + domainName); }
								else { res.send(record); }
							    });
						})
					    .catch((e) => {
						    logger.error('failed adding record ' + params.recordName + ' for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input editing record');
			    logger.error(e);
			    res.status(400).send('invalid input editing record');
			});
	    });
	app.get('/records/:domainName/get/:recordName', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'get-record-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:ro')
				.then((userId) => {
					let domainName = params.domainName;
					let recordName = params.recordName;
					let renderWith = { username: req.session.username, domain: domainName, records: [] };
					apiRoutes.getRecords(cassandra, domainName, recordName)
					    .then((records) => {
						    for (let k = 0; k < records.length; k++) {
							let healthCheck = '', hcID = false;
							if (records[k].healthcheckid !== undefined && records[k].healthcheckid !== false && records[k].healthcheckid !== null) {
							    healthCheck = '<a href="/healthchecks/' + domainName + '/get/' + records[k].healthcheckid + '">' + records[k].healthcheckid + '</a>';
							    hcID = records[k].healthcheckid;
							} else { healthCheck = 'none'; }
							renderWith.records.push({ name: records[k].name, type: records[k].type, priority: records[k].priority, target: records[k].target, setid: records[k].setid, healthcheck: healthCheck, healthcheckid: hcID, ttl: records[k].ttl });
						    }
						    let output = Mustache.render(templates['listRecords'], renderWith);
						    res.send(output);
						})
					    .catch((e) => {
						    logger.error('failed listing records for ' + req.session.userid);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing records';
						    let output = Mustache.render(templates['backendError'], renderWith);
						    res.send(output);
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching record');
			    logger.error(e);
			    res.status(400).send('invalid input fetching record');
			});
	    });
	app.post('/records/:domainName/get/:recordName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-record-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:ro')
				.then((userId) => {
					let domainName = params.domainName || false;
					let recordName = params.recordName || false;
					apiRoutes.getRecords(cassandra, domainName, recordName)
					    .then((records) => { res.send(records); })
					    .catch((e) => {
						    logger.error('failed fetching record ' + recordName + ' for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching record');
			    logger.error(e);
			    res.status(400).send('invalid input fetching record');
			});
	    });
	app.get('/records/:domainName', (req, res) => {
		cmdValidation(req, res, 'get-records-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:ro')
				.then((userId) => {
					let domainName = params.domainName || 'example.com';
					let renderWith = { username: req.session.username, domain: domainName, records: [], checks: [] };
					apiRoutes.listRecords(cassandra, domainName)
					    .then((records) => {
						    for (let k = 0; k < records.length; k++) {
							let healthCheck = '', hcID = false;
							if (records[k].healthcheckid !== undefined && records[k].healthcheckid !== false && records[k].healthcheckid !== null) {
							    healthCheck = '<a href="/healthchecks/' + domainName + '/get/' + records[k].healthcheckid + '">' + records[k].healthcheckid + '</a>';
							    hcID = records[k].healthcheckid;
							} else { healthCheck = 'none'; }
							renderWith.records.push({ name: records[k].name, type: records[k].type, priority: records[k].priority, target: records[k].target, setid: records[k].setid, healthcheck: healthCheck, healthcheckid: hcID, ttl: records[k].ttl });
						    }
						    apiRoutes.listHealthChecks(cassandra, domainName)
							.then((hc) => {
								for (let k = 0; k < hc.length; k++) {
								    renderWith.checks.push({ checkid: hc[k].uuid, checktarget: hc[k].target });
								}
								let output = Mustache.render(templates['listRecords'], renderWith);
								res.send(output);
							    })
							.catch((e) => {
								logger.error('failed listing health checks rendering records index');
								logger.error(e);
								let output = Mustache.render(templates['listRecords'], renderWith);
								res.send(output);
							    });
						})
					    .catch((e) => {
						    logger.error('failed listing records for ' + req.session.userid);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing records';
						    let output = Mustache.render(templates['backendError'], renderWith);
						    res.send(output);
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing records');
			    logger.error(e);
			    res.status(400).send('invalid input listing records');
			});
	    });
	app.post('/records/:domainName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-records-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:ro')
				.then((userId) => {
					let domainName = params.domainName || false;
					apiRoutes.listRecords(cassandra, domainName)
					    .then((records) => { res.send(records); })
					    .catch((e) => {
						    logger.error('failed listing records for ' + userId + ' ' + domainName);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing records');
			    logger.error(e);
			    res.status(400).send('invalid input listing records');
			});
	    });

	app.get('/register', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/register', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'register')
		    .then((params) => {
			    let username = params.username || false;
			    if (params.password !== params.passwordConfirm) {
				logger.error('mismatching passwords registering');
				res.status(400).send('mismatching passwords registering account');
			    } else {
				apiRoutes.registerAccount(cassandra, username, params.emailaddr, params.password)
				    .then((response) => {
					    logger.info('registered ' + username + ' (' + params.emailaddr + ') via ' + params.actualIP);
					    let renderWith = { username: username, confmsg: 'please confirm your email address, clicking the link we just sent you' };
					    let output = Mustache.render(templates['backendConfirmation'], renderWith);
					    res.send(output);
					})
				    .catch((e) => {
					    logger.error('failed registering user ' + username + ' (' + params.emailaddr + ') via ' + params.actualIP);
					    logger.error(e);
					    let renderWith = { username: username, errormsg: 'failed registering account' };
					    let output = Mustache.render(templates['backendConfirmation'], renderWith);
					    res.send(output);
					});
			    }
			})
		    .catch((e) => {
			    logger.error('invalid input registering account');
			    logger.error(e);
			    res.redirect(301, '/login');
			});
	    });

	app.get('/settings/2fa/confirm', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/2fa/confirm', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, '2fa-confirm')
		    .then((params) => {
			    authValidation(cassandra, req, 'setting:rw')
				.then((userId) => {
					apiRoutes.confirm2fa(cassandra, userId, params.confirmation)
					    .then((resp) => {
						    if (resp) {
							if (req.session.username !== undefined) { res.redirect('/settings'); }
							else { res.send('OK'); }
						    } else if (req.session.username !== undefined) {
							res.redirect(301, '/login');
						    } else {
							logger.error('failed authenticating (2fa) user from ' + params.actualIP);
							logger.error(e);
							res.status(401).send('2fa authentication failed');
						    }
						})
					    .catch((e) => {
						    logger.error('failed confirming 2fa for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
					})
				    .catch((e) => {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e);
					    res.redirect(301, '/login');
					});
			})
		    .catch((e) => {
			    logger.error('faulty input confirming 2fa');
			    logger.error(e);
			    res.status(400).send('invalid input confirming 2fa');
			});
	    });
	app.get('/settings/2fa/enable', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/2fa/enable', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, '2fa-enable')
		    .then((params) => {
			    authValidation(cassandra, req, 'setting:rw')
				.then((userId) => {
					apiRoutes.enable2fa(cassandra, userId)
					    .then((token) => {
						    if (req.session.username !== undefined) {
							QRCode.toDataURL(token.otpauth_url, function(err, data_url) {
								if (err) {
								    let renderWith = { username: req.session.username, email: req.session.email, userid: req.session.userid, twofadata: '<b>failed to enable</b>', logindata: [] };
								    let output = Mustache.render(templates['settings'], renderWith);
								    res.send(output);
								} else {
								    let renderWith = { username: req.session.username, email: req.session.email, userid: req.session.userid, twofaurl: data_url, logindata: [] };
								    let output = Mustache.render(templates['enable2fa'], renderWith);
								    res.send(output);
								}
							    })
						    } else { res.send(token.otpauth_url); }
						})
					    .catch((e) => {
						    logger.error('failed enabling 2fa for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
					})
				    .catch((e) => {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e);
					    res.redirect(301, '/login');
					});
			})
		    .catch((e) => {
			    logger.error('faulty input enabling 2fa');
			    logger.error(e);
			    res.status(400).send('invalid input enabling 2fa');
			});
	    });
	app.get('/settings/2fa/disable', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/2fa/disable', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, '2fa-disable')
		    .then((params) => {
			    authValidation(cassandra, req, 'setting:rw')
				.then((userId) => {
					apiRoutes.disable2fa(cassandra, userId, params.confirmation)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/settings'); }
						    else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed disabling 2fa for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
					})
				    .catch((e) => {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e);
					    res.redirect(301, '/login');
					});
			})
		    .catch((e) => {
			    logger.error('faulty input disabling 2fa');
			    logger.error(e);
			    res.status(400).send('invalid input disabling 2fa');
			});
	    });
	app.get('/settings/confirm-address/:userId/:token', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'confirm-address')
		    .then((params) => {
			    apiRoutes.confirmAddress(cassandra, params.userId, params.token)
				.then((confirmed) => { res.send('OK'); })
				.catch((e) => {
					logger.error('failed confirming address');
					logger.error(e);
					let renderWith = { username: 'unknown', errormsg: e };
					let output = Mustache.render(templates['backendError'], renderWith);
					res.send(output);
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input confirming address');
			    logger.error(e);
			    let renderWith = { username: 'unknown', errormsg: 'unable to confirm address' };
			    let output = Mustache.render(templates['backendError'], renderWith);
			    res.send(output);
			});
	    });
	app.post('/settings', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'settings-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					if (req.body.emailaddr !== req.session.email) {
					    apiRoutes.updateAddress(cassandra, userId, req.body.emailaddr)
						.then((resp) => {
							if (req.session.username !== undefined) { res.redirect('/settings'); }
							else { res.send(resp); }
						    })
						.catch((e) => {
							logger.error('failed listing records for ' + userId + ' ' + domainName);
							logger.error(e);
							res.status(500).send('backend error');
						    });
					} else if (req.body.password !== undefined) {
					    apiRoutes.updatePassword(cassandra, userId, params.password)
						.then((resp) => {
							if (req.session.username !== undefined) { res.redirect('/settings'); }
							else { res.send(resp); }
						    })
						.catch((e) => {
							logger.error('failed listing records for ' + userId + ' ' + domainName);
							logger.error(e);
							res.status(500).send('backend error');
						    });
					} else {
					    logger.error('wtf settings update');
					    res.status(400).send('I say what what ....');
					}
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input editing settings');
			    logger.error(e);
			    res.status(400).send('invalid input editing settings');
			});
	    });
	app.get('/settings', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'settings-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:ro')
				.then((userId) => {
				    let disable2fa = "<table align='center'><tr><td><img src='/static/healthy.png' height='20px' width='20px'/>"
						    + "</td><td width='10%'>&nbsp;</td><td><form method=POST action='/settings/2fa/disable'>"
						    + "<div class='bad'>Enter code to deconfigure:</div><br/>"
						    + "<input type=text name='confirmation' size='8'><br/>"
						    + "<input type=submit value='Disable 2FA'>"
						    + "</form></td></tr></table>";
				    let enable2fa = "<table align='center'><tr><td><img src='/static/unhealthy.png' height='20px' width='20px'/>"
						    + "</td><td width='10%'>&nbsp;</td><td><form method=POST action='/settings/2fa/enable'>"
						    + "<input type=submit value='Enable 2FA'>"
						    + "</form></td></tr></table>";
				    let renderWith = { username: req.session.username, email: req.session.email, userid: userId, logindata: [] };
				    apiRoutes.getUser(cassandra, userId)
					.then((resp) => {
						renderWith.twofadata = (resp.enabled === true ? disable2fa : enable2fa);
						apiRoutes.listLogins(cassandra, userId)
						    .then((loginhistory) => {
							    for (let k = 0; k < loginhistory.length; k++) {
								let whenString = new Date(Math.round(loginhistory[k].time)).toISOString();
								let successString = (loginhistory[k].succeeded === true) ? 'healthy' : 'unhealthy';
								renderWith.logindata.push({ time: whenString, clientip: loginhistory[k].clientip, succeeded: successString });
							    }
							    let output = Mustache.render(templates['settings'], renderWith);
							    res.send(output);
							})
						    .catch((e) => {
							    renderWith.logindata.push({ time: '', clientip: 'failed querying logins history', succeeded: 'unhealthy' });
							    let output = Mustache.render(templates['settings'], renderWith);
							    res.send(output);
							});
					    })
					.catch((e) => {
						logger.error('failed to checkout 2fa status for ' + userId);
						logger.error(e);
						renderWith.twofadata = enable2fa;
						let output = Mustache.render(templates['settings'], renderWith);
						res.send(output);
					    });
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching settings');
			    logger.error(e);
			    res.status(400).send('invalid input fetching settings');
			});
	    });

	app.get('/tokens/add', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/tokens/add', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-token')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:rw')
				.then((userId) => {
					cperms = new String(params.tokenPerms || '*').replace(/ /g, '');
					csrc = new String(params.tokenPerms || '*').replace(/ /g, '');
					let tokenObject = { perms: cperms, src: csrc };
					apiRoutes.addToken(cassandra, userId, tokenObject)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/tokens'); }
						    else { res.send(token); }
						})
					    .catch((e) => {
						    logger.error('failed adding token for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
					})
				    .catch((e) => {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e);
					    res.status(401).send('authentication failed');
					});
			})
		    .catch((e) => {
			    logger.error('faulty input adding token');
			    logger.error(e);
			    res.status(400).send('invalid input adding token');
			});
	    });
	app.get('/tokens/edit', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/tokens/edit', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'edit-token')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:rw')
				.then((userId) => {
					cperms = new String(params.tokenPerms || '*').replace(/ /g, '');
					csrc = new String(params.tokenPerms || '*').replace(/ /g, '');
					let tokenObject = { id: params.tokenId, perms: cperms, src: csrc };
					apiRoutes.editToken(cassandra, userId, tokenObject)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/tokens'); }
						    else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed editing token for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
					})
				    .catch((e) => {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e);
					    res.status(401).send('authentication failed');
					});
			})
		    .catch((e) => {
			    logger.error('faulty input editing token');
			    logger.error(e);
			    res.status(400).send('invalid input editing token');
			});
	    });
	app.get('/tokens/del', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/tokens/del', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'del-token')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:rw')
				.then((userId) => {
					apiRoutes.delToken(cassandra, userId, req.body.tokenString)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/tokens'); }
						    else { res.send(token); }
						})
					    .catch((e) => {
						    logger.error('failed adding token for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input dropping token');
			    logger.error(e);
			    res.status(400).send('invalid input dropping token');
			});
	    });
	app.post('/tokens', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-tokens-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:ro')
				.then((userId) => {
					apiRoutes.listTokens(cassandra, userId)
					    .then((tokens) => { res.send(tokens); })
					    .catch((e) => {
						    logger.error('failed listing tokens for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing tokens');
			    logger.error(e);
			    res.status(400).send('invalid input listing tokens');
			});
	    });
	app.get('/tokens', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'get-tokens-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:ro')
				.then((userId) => {
					apiRoutes.listTokens(cassandra, userId)
					    .then((tokens) => {
						    let renderWith = { username: req.session.username, records: [] };
						    for (let k = 0; k < tokens.length; k++) {
							renderWith.records.push({ tokenstring: tokens[k].tokenstring, perms: tokens[k].permissions, trusted: tokens[k].trusted });
						    }
						    let output = Mustache.render(templates['tokens'], renderWith);
						    res.send(output);
						})
					    .catch((e) => {
						    logger.error('failed listing tokens for ' + userId);
						    logger.error(e);
						    res.status(500).send('backend error');
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect(301, '/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing tokens');
			    logger.error(e);
			    res.status(400).send('invalid input listing tokens');
			});
	    });
    }
