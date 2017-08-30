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
const defaultBackupPool = process.env.HWTH_BACKUP_POOL || 'default';
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

module.exports = (app, cassandra, confQueues, zonesQueues, notifyQueue) => {
	this._globalHealth = false;
	let self = this;
	this._healthJob = schedule.scheduleJob('*/10 * * * * *', () => {
		cassandra.execute('SELECT * FROM system.local')
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				self._globalHealth = true;
			    } else { self._globalHealth = false; }
			})
		    .catch((e) => {
			    self._globalHealth = false;
			});
	    });
	this._getPool = function(domainName) {
		return new Promise ((resolve, reject) => {
			let lookupPool = "SELECT nspool, bkppool FROM zones WHERE origin = '" + domainName + "'";
			cassandra.execute(lookupPool)
			    .then((resp) => {
				    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
					resolve({ nsPool: resp.rows[0].nspool, bkpPool: resp.rows[0].bkppool });
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
		if (req.session.username !== undefined) { res.redirect('/domains'); }
		else { res.redirect('/login'); }
	    });

	app.get('/ping', (req, res) => {
		getProbe.mark();
		if (this._globalHealth === true) { res.send('OK'); }
		else { res.status(500).send('backend error'); }
	    });

	app.get('/version', (req, res) => {
		getProbe.mark();
		res.send('highwaytohell API gateway ' + tag);
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
					if (userobj.notifyLogin === true) {
					    notifyQueue.createJob({ what: 'login', who: assumesId }).save();
					}
					res.redirect('/domains');
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e.reason);
					if (e.notifyFailed === true) {
					    notifyQueue.createJob({ what: 'failed login', who: assumesId }).save();
					}
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input on 2FA login from ' + assumesId);
			    logger.error(e);
			    res.redirect('/login');
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
					req.session.userid = resp.res.uuid;
					req.session.username = resp.res.username;
					req.session.email = seenId;
					logger.info('authenticated ' + req.session.userid);
					if (resp.notifyLogin === true) {
					    notifyQueue.createJob({ what: 'login', who: resp.res.uuid }).save();
					}
					res.redirect('/domains');
				}).catch((e) => {
					if (e.reason !== undefined && e.reason === '2FA') {
					    apiRoutes.login2fa(seenId)
						.then((secret) => { res.send(Mustache.render(templates['login2fa'], { userid: e.userid, secret: secret })); })
						.catch((de) => {
							logger.error('failed serving 2FA user with second-factor token');
							logger.error(de);
							res.redirect('/login');
						    });
					} else {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e.reason);
					    if (e.notifyFailed === true) {
						notifyQueue.createJob({ what: 'failed login', who: seenId }).save();
					    }
					    res.redirect('/login');
					}
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input on login from ' + seenId);
			    logger.error(e);
			    res.redirect('/login');
			});
	    });
	app.get('/login', (req, res) => {
		getProbe.mark();
	    /*
	     * we should have client browser hash its passphrase, somehow
	     */
		let regLink = "or <a onclick='showForm();' href='#'>Register an Account</a>";
		if (process.env.LOCK_REGISTRATIONS !== undefined) { regLink = '&nbsp;'; }
		if (req.session.username !== undefined) { res.redirect('/domains'); }
		else { res.send(Mustache.render(templates['login'], { regLink: regLink })); }
	    });
	app.get('/logout', (req, res) => {
		getProbe.mark();
		try {
		    req.session.userid = false;
		    req.session.username = false;
		    req.session.email = false;
		    req.session.destroy();
		    delete req.session;
		    res.redirect('/login');
		} catch(e) { res.redirect('/login'); }
	    });

	app.post('/domains', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'list-domains-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'zones:ro')
				.then((userId) => {
					apiRoutes.listZones(cassandra, userId, null)
					    .then((zones) => {
						    /* FIXME: either translate nspool to FQDNs, or add a separate route doing so */
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
					apiRoutes.listZones(cassandra, userId, false)
					    .then((zones) => {
						    for (let k = 0; k < zones.length; k++) {
							let hasDnssec = (zones[k].ksk !== undefined && zones[k].ksk !== null && zones[k].zsk !== undefined && zones[k].zsk !== null) ? 'is enabled' : 'is not configured';
							/* FIXME query nspools for FQDNs ? */
							let nsPool =  zones[k].nspool + ' - ' + zones[k].bkppool;
							renderWith.records.push({ origin: zones[k].origin, serial: zones[k].serial, hasdnssec: hasDnssec, nspool: nsPool });
						    }
						    res.send(Mustache.render(templates['listDomains'], renderWith));
						})
					    .catch((e) => {
						    logger.error('failed listing domains for ' + userId);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing domains';
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing domains');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input listing domains' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input listing domains'); }
			});
	    });

	app.get('/domains/:domainName/admin/add', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/domains/:domainName/admin/add', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-authorization')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:adm')
				.then((userId) => {
					let perm = {
						settingUser: userId,
						thirdParty: params.thirdParty,
						assumesRole: params.assumesRole
					    };
					apiRoutes.addPermission(cassandra, domainName, perm)
					    .then((perm) => {
						    if (req.session.username !== undefined) {
							res.redirect('/domains/' + domainName + '/admin');
						    } else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed adding authorization to ' + domainName + ' for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: e };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send(e); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.acualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input adding authorization');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input adding authorization' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input adding authorization'); }
			});
	    });
	app.get('/domains/:domainName/admin/del', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/domains/:domainName/admin/del', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'del-authorization')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:adm')
				.then((userId) => {
					let perm = {
						settingUser: userId,
						thirdParty: params.thirdParty
					    };
					apiRoutes.delPermission(cassandra, domainName, perm)
					    .then((perm) => {
						    if (req.session.username !== undefined) {
							res.redirect('/domains/' + domainName + '/admin');
						    } else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed dropping authorization to ' + domainName + ' for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: e };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send(e); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.acualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input dropping authorization');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input dropping authorization' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input dropping authorization'); }
			});
	    });
	app.post('/domains/:domainName/admin', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'adm-domain-post')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:adm')
				.then((userId) => {
					apiRoutes.listPermissions(cassandra, domainName)
					    .then((perms) => { res.send(perms); })
					    .catch((e) => {
						    logger.error('failed fetching ' + domainName + ' authorizations for ' + userId);
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
			    logger.error('faulty input fetching domain authorizations');
			    logger.error(e);
			    res.status(400).send('invalid input fetching domain authorizations');
			});
	    });
	app.get('/domains/:domainName/admin', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'adm-domain-get')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:adm')
				.then((userId) => {
					let renderWith = { username: req.session.username || userId, domain: domainName };
					apiRoutes.listPermissions(cassandra, domainName)
					    .then((perms) => {
						    if (req.session.username !== undefined) {
							renderWith.records = perms;
							res.send(Mustache.render(templates['adminDomain'], renderWith));
						    } else { res.send(perms); }
						})
					    .catch((e) => {
						    logger.error('failed fetching ' + domainName + ' authorizations for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							renderWith.errormsg = 'failed fetching ' + domainName + ' authorizations';
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('backend error'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching domain authorizations');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input fetching domain authorizations' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input fetching domain authorizations'); }
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
			    authValidation(cassandra, req, 'zones:adm')
				.then((userId) => {
					apiRoutes.addZone(cassandra, userId, domainName)
					    .then((zone) => {
						    if (confQueues[defaultPool] !== undefined) {
							logger.info('notifying refresh workers to reload ' + domainName);
							confQueues[defaultPool].createJob({ origin: domainName }).save();
						    } else { logger.info('no queue running for ' + defaultPool + ' -- 1 + 1 = 3'); }
						    if (defaultPool !== defaultBackupPool) {
							if (confQueues[defaultBackupPool] !== undefined) {
							    logger.info('notifying refresh workers to reload ' + domainName + ' on backup queue');
							    confQueues[defaulBackuptPool].createJob({ origin: domainName }).save();
							} else { logger.info('no queue running for ' + defaultBackupPool + ' -- 1 + 1 = 3'); }
						    }
						    if (req.session.username !== undefined) { res.redirect('/domains'); }
						    else { res.send(zone); }
						})
					    .catch((e) => {
						    logger.error('failed adding zone ' + domainName + ' for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: e };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send(e); }
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
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input adding domains'); }
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
			    authValidation(cassandra, req, 'zones:adm')
				.then((userId) => {
					self._getPool(domainName)
					    .then((pools) => {
						    apiRoutes.delZone(cassandra, domainName)
							.then((zone) => {
								if (confQueues[pools.nsPool] !== undefined) {
								    logger.info('notifying ' + pools.nsPool + ' refresh workers to reload ' + domainName);
								    confQueues[pools.nsPool].createJob({ origin: domainName }).save();
								} else { logger.info('no queue running for ' + pools.nsPool + ' -- restart REQUIRED!'); }
								if (pools.bkpPool !== pools.nsPool) {
								    if (confQueues[pools.bkpPool] !== undefined) {
									logger.info('notifying ' + pools.bkpPool + ' refresh workers to reload ' + domainName);
									confQueues[pools.bkpPool].createJob({ origin: domainName }).save();
								    } else { logger.info('no queue running for ' + pools.bkpPool + ' -- restart REQUIRED!'); }
								}
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
						    apiRoutes.delZone(cassandra, domainName)
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
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input dropping domain'); }
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
					apiRoutes.disableDnssec(cassandra, domainName)
					    .then((dnssec) => {
						    self._getPool(domainName)
							.then((pools) => {
								if (zonesQueues[pools.nsPool] !== undefined) {
								    logger.info('notifying ' + pools.nsPool + ' refresh workers to reload ' + domainName);
								    zonesQueues[pools.nsPool].createJob({ origin: domainName, confReload: true }).save();
								} else { logger.info('no queue running for ' + pools.nsPool + ' -- restart REQUIRED!'); }
								if (pools.bkpPool !== pools.nsPool) {
								    if (zonesQueues[pools.bkpPool] !== undefined) {
									logger.info('notifying ' + pools.bkpPool + ' refresh workers to reload ' + domainName);
									zonesQueues[pools.bkpPool].createJob({ origin: domainName, confReload: true }).save();
								    } else { logger.info('no queue running for ' + pools.bkpPool + ' -- restart REQUIRED!'); }
								}
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
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: e };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send(e); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input disabling dissec' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input disabling dnssec'); }
			});
	    });
	app.get('/domains/:domainName/getdnssec', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/domains/:domainName/getdnssec', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:ro')
				.then((userId) => {
					apiRoutes.getZoneDS(cassandra, domainName)
					    .then((ds) => {
						    if (ds.ds !== undefined) { res.send(ds.ds); }
						    else { res.send({}); }
						})
					    .catch((e) => {
						    logger.error('failed fetching ' + domainName + ' ds records for ' + userId);
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
			    logger.error('faulty input fetching ds records');
			    logger.error(e);
			    res.status(400).send('invalid input fetching ds records');
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
					apiRoutes.enableDnssec(cassandra, domainName)
					    .then((dnssec) => {
						    self._getPool(domainName)
							.then((pools) => {
								if (zonesQueues[pools.nsPool] !== undefined) {
								    logger.info('notifying ' + pools.nsPool + ' refresh workers to reload ' + domainName);
								    zonesQueues[pools.nsPool].createJob({ origin: domainName, confReload: true }).save();
								} else { logger.info('no queue running for ' + pools.nsPool + ' -- restart REQUIRED!'); }
								if (pools.nsPool !== pools.bkpPool) {
								    if (zonesQueues[pools.bkpPool] !== undefined) {
									logger.info('notifying ' + pools.bkpPool + ' refresh workers to reload ' + domainName);
									zonesQueues[pools.bkpPool].createJob({ origin: domainName, confReload: true }).save();
								    } else { logger.info('no queue running for ' + pools.bkpPool + ' -- restart REQUIRED!'); }
								}
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
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: e };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send(e); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input enabling dissec' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input enabling dnssec'); }
			});
	    });
	app.post('/domains/:domainName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-domain')
		    .then((params) => {
			    let domainName = params.domainName;
			    authValidation(cassandra, req, 'zones:ro')
				.then((userId) => {
					apiRoutes.getZone(cassandra, domainName)
					    .then((zone) => { res.send(zone); })
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
					apiRoutes.getZone(cassandra, domainName)
					    .then((zone) => {
						    apiRoutes.listPermissions(cassandra, domainName)
							.then((perms) => {
								for (let k = 0; k < perms.length; k++) {
								    if (perms[k].uuid === req.session.userid) {
									if (perms[k].role === 'admin') {
									    renderWith.admMagic = "<tr><th class='dsecname'>Permissions</th><td class='descdata'><a href='/domains/" + domainName + "/admin'>Manage Accesses</a></td></tr>";
									}
								    }
								}
								let dnssecdata = "<form method='post' action='/domains/" + domainName + "/";
								if (zone.ksk !== undefined && zone.ksk !== false && zone.ksk !== null && zone.zsk !== undefined && zone.zsk !== false && zone.zsk !== null) {
								    dnssecdata += "disablednssec'><div class='good'>Enabled</div>";
								    apiRoutes.getZoneDS(cassandra, domainName)
									.then((ds) => {
										if (ds.ds !== undefined) {
										    dnssecdata += "DS KEYs:<br/><div class='dskeys'>" + ds.ds.toString().replace(/\n/g, '<br/>') + "</div>";
										} else {
										    dnssecdata += "Unable to find DS KEYs yet - if problem persists, try adding a record or contact support<br/>";
										}
										dnssecdata += "<input type='submit' value='Disable DNSSEC'/></form>";
										renderWith['dnssec'] = dnssecdata;
										renderWith['nspool'] = zone.nspool + '<br/>' + zone.bkppool;
										renderWith['origin'] = zone.origin;
										renderWith['serial'] = zone.serial;
										res.send(Mustache.render(templates['getDomain'], renderWith));
									    })
									.catch((e) => {
										logger.error('failed looking up DS record');
										logger.error(e);
										dnssecdata += "'>Failed looking up DS records, please try again later</form>";
										renderWith['dnssec'] = dnssecdata;
										renderWith['nspool'] = zone.nspool + '<br/>' + zone.bkppool;
										renderWith['origin'] = zone.origin;
										renderWith['serial'] = zone.serial;
										res.send(Mustache.render(templates['getDomain'], renderWith));
									    });
								} else {
								    dnssecdata += "enablednssec'><div class='bad'>Disabled</div><input type='submit' value='Enable DNSSEC'/></form>";
								    renderWith['dnssec'] = dnssecdata;
								    renderWith['nspool'] = zone.nspool + '<br/>' + zone.bkppool;
								    renderWith['origin'] = zone.origin;
								    renderWith['serial'] = zone.serial;
								    res.send(Mustache.render(templates['getDomain'], renderWith));
								}
							    })
							.catch((e) => {
								logger.error('failed listing permissions for ' + domainName);
								logger.error(e);
								if (req.session.username !== undefined) {
								    renderWith['errormsg'] = 'failed fetching domains permissions';
								    res.send(Mustache.render(templates['backendError'], renderWith));
								} else { res.status(500).send('failed fetching domains permissions'); }
							    });
						})
					    .catch((e) => {
						    logger.error('failed fetching ' + domainName + ' zone settings ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							renderWith['errormsg'] = 'failed fetching domains';
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed fetching domains'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching domain');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input fetching domains' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input fetching domain'); }
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
						    for (let k = history.length - 1; k >= 0; k--) {
							let whenString = new Date(Math.round(history[k].when)).toISOString();
							let valueString = (history[k].value === true) ? 'healthy' : 'unhealthy';
							renderWith.records.push({ when: whenString, value: valueString });
						    }
						    res.send(Mustache.render(templates['listHealthHistory'], renderWith));
						})
					    .catch((e) => {
						    logger.error('failed fetching health history for ' + userId);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed fetching healthcheck history';
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing healthcheck history');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input listing healthchecks history' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input listing healthcheck history'); }
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
					    .then((history) => { res.send(history); })
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
						name: params.checkName || false,
						unhealthyThreshold: params.checkUnhealthy || 2,
						uuid: false
					    };
					apiRoutes.addHealthCheck(cassandra, domainName, checkObject)
					    .then((check) => {
						    if (req.session.username !== undefined) {
							res.redirect('/healthchecks/' + domainName);
						    } else { res.send(check); }
						})
					    .catch((e) => {
						    logger.error('failed adding health check for ' + userId + ' ' + domainName);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed adding health check' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed adding health check'); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input adding health check' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input adding health check'); }
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
						    if (req.session.username !== undefined) { res.redirect('/healthchecks/' + domainName); }
						    else { res.send(check); }
						})
					    .catch((e) => {
						    logger.error('failed dropping health check for ' + userId + ' ' + domainName);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed dropping health check' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed dropping health check'); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input dropping health check' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input dropping health check'); }
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
						name: params.checkName || false,
						unhealthyThreshold: params.checkUnhealthy || 2,
						uuid: params.checkId
					    };
					apiRoutes.addHealthCheck(cassandra, domainName, checkObject)
					    .then((check) => {
						    if (req.session.username !== undefined) { res.redirect('/healthchecks/' + domainName); }
						    else { res.send(check); }
						})
					    .catch((e) => {
						    logger.error('failed updating health check for ' + userId + ' ' + domainName);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed editing health check' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed editing health check'); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input editing health check' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input editing health check'); }
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
						    res.send(Mustache.render(templates['getHealthCheck'], renderWith));
						})
					    .catch((e) => {
						    logger.error('failed fetching healthcheck settings ' + userId);
						    logger.error(e);
						    let renderWith = { username: req.session.username , errormsg: 'failed fetching healthcheck settings' };
						    res.send(Mustache.render(templates['backendError'], renderWith));
						})
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching health check');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input fetching health check' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input fetching health check'); }
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
					    .then((check) => { res.send(check); })
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
							if (checks[k].headers !== undefined && checks[k].headers !== false && checks[k].headers !== null) { headers = 'Host: ' + checks[k].headers; headersstr = checks[k].headers; }
							if (checks[k].type === 'http' && checks[k].target !== undefined && checks[k].target !== false) { target = "<a href='" + checks[k].target + "' target='_blank'>" + checks[k].target + "</a>"; }
							else if (checks[k].type === 'icmp') { headers = '-'; match= '-'; }
							renderWith.records.push({ checkid: checks[k].uuid, type: checks[k].type, invert: invert, checkname: checks[k].name,
								headers: headers, target: target, match: match, nspool: checks[k].nspool, headersstr: headersstr,
								reqhealthy: checks[k].requirehealthy, requnhealthy: checks[k].requireunhealthy, targetstr: checks[k].target });
						    }
						    res.send(Mustache.render(templates['listHealthChecks'], renderWith));
						})
					    .catch((e) => {
						    logger.error('failed listing checks for ' + userId);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing healthcheck';
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing health checks');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input listing health checks' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input listing health checks'); }
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
					    .then((checks) => { res.send(checks); })
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

	app.get('/notifications/:domainName/add/:checkId', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/notifications/:domainName/add/:checkId', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-notification')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
				    /* FIXME: the following may overwrite some existing conf */
				    /* add some check preventing this ... the /edit/ path is meant for that */
					let domainName = req.params.domainName || false;
					let notObj = {
						checkId: req.params.checkId,
						downAfter: req.params.notifyDown || 2,
						upAfter: req.params.notifyUp || 2,
						driver: req.params.notifyType,
						target: req.params.notifyTarget
					    };
					apiRoutes.addNotification(cassandra, userId, domainName, notObj)
					    .then((checks) => {
						    if (req.session.username !== undefined) { res.redirect('/notifications/' + domainName); }
						    else { res.send(notObj.checkId); }
						})
					    .catch((e) => {
						    logger.error('failed adding notification for ' + userId + ' ' + domainName + '/' + notObj.checkId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed adding notification' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed adding notification'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input adding notification');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input adding notification' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input adding notification'); }
			});
	    });
	app.get('/notifications/:domainName/del/:checkId', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/notifications/:domainName/del/:checkId', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'del-notification')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let checkId = req.params.checkId;
					let domainName = req.params.domainName || false;
					apiRoutes.delNotification(cassandra, domainName, checkId)
					    .then((checks) => {
						    if (req.session.username !== undefined) { res.redirect('/notifications/' + domainName); }
						    else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed dropping notification for ' + userId + ' ' + domainName + '/' + checkId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed dropping notification' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed dropping notification'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input dropping notification');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input dropping notification' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input dropping notification'); }
			});
	    });
	app.get('/notifications/:domainName/edit/:checkId', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/notifications/:domainName/edit/:checkId', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-notification')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let domainName = req.params.domainName || false;
					let notObj = {
						checkId: req.params.checkId,
						downAfter: req.params.notifyDown || 2,
						upAfter: req.params.notifyUp || 2,
						driver: req.params.notifyType,
						target: req.params.notifyTarget
					    };
					apiRoutes.addNotification(cassandra, userId, domainName, notObj)
					    .then((checks) => {
						    if (req.session.username !== undefined) { res.redirect('/notifications/' + domainName); }
						    else { res.send(notObj.checkId); }
						})
					    .catch((e) => {
						    logger.error('failed editing notification for ' + userId + ' ' + domainName + '/' + notObj.checkId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed editing notification' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed editing notification'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input editing notification');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input editing notification' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input editing notification'); }
			});
	    });
	app.get('/notifications/:domainName/get/:checkId', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/notifications/:domainName/get/:checkId', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-notification-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let domainName = req.params.domainName || false;
					let checkId = req.params.checkId;
					apiRoutes.listNotifications(cassandra, domainName, checkId)
					    .then((checks) => { res.send(checks); })
					    .catch((e) => {
						    logger.error('failed fetching notifications for ' + userId + ' ' + domainName + '/' + checkId);
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
			    logger.error('faulty input fetching notifications');
			    logger.error(e);
			    res.status(400).send('invalid input fetching notifications');
			});
	    });
	app.get('/notifications/:domainName', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'get-notifications-get')
		    .then((params) => {
			    let domainName = params.domainName || 'example.com';
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let renderWith = { username: req.session.username, domain: domainName, records: [], checks: [], contacts: [] };
					apiRoutes.listHealthChecks(cassandra, domainName)
					    .then((hc) => {
						    for (let k = 0; k < hc.length; k++) {
							renderWith.checks.push({ checkid: hc[k].uuid, checktarget: hc[k].target, checklabel: hc[k].name });
						    }
						    apiRoutes.listContacts(cassandra, userId)
							.then((contacts) => {
								if (contacts.length > 0) {
								    for (let k = 0; k < contacts.length; k++) {
									if (contacts[k].confirmcode === 'true') {
									    renderWith.contacts.push({ target: contacts[k].target });
									}
								    }
								}
								if (renderWith.contacts.length === 0 && req.session.email !== undefined) {
								    renderWith.contacts.push({ target: req.session.email })
								}
								apiRoutes.listNotifications(cassandra, domainName, false)
								    .then((checks) => {
									    for (let k = 0; k < checks.length; k++) {
										renderWith.records.push({ checkid: checks[k].idcheck, down: checks[k].notifydownafter, label: checks[k].name,
											up: checks[k].notifyupafter, target: checks[k].notifytarget, driver: checks[k].notifydriver });
									    }
									    res.send(Mustache.render(templates['listNotifications'], renderWith));
									})
								    .catch((e) => {
									    logger.error('failed listing notifications for ' + userId);
									    logger.error(e);
									    renderWith['errormsg'] = 'failed listing notifications';
									    res.send(Mustache.render(templates['backendError'], renderWith));
									});
							    })
							.catch((e) => {
								logger.error('failed listing contacts for ' + userId);
								logger.error(e);
								if (req.session.email !== undefined) {
								    renderWith.contacts.push({ target: req.session.email })
								}
								apiRoutes.listNotifications(cassandra, domainName, false)
								    .then((checks) => {
									    for (let k = 0; k < checks.length; k++) {
										renderWith.records.push({ checkid: checks[k].idcheck, down: checks[k].notifydownafter, label: checks[k].name,
											up: checks[k].notifyupafter, target: checks[k].notifytarget, driver: checks[k].notifydriver });
									    }
									    res.send(Mustache.render(templates['listNotifications'], renderWith));
									})
								    .catch((e) => {
									    logger.error('failed listing checks for ' + userId);
									    logger.error(e);
									    renderWith['errormsg'] = 'failed listing notifications';
									    res.send(Mustache.render(templates['backendError'], renderWith));
									});
							    });
						})
					    .catch((e) => {
						    logger.error('failed listing health checks for ' + userId);
						    logger.error(e);
						    apiRoutes.listContacts(cassandra, userId)
							.then((contacts) => {
								if (contacts.length > 0) {
								    for (let k = 0; k < contacts.length; k++) {
									if (contacts[k].confirmcode === 'true') { renderWith.contacts.push({ target: contacts[k].target }); }
								    }
								}
								if (renderWith.contacts.length === 0 && req.session.email !== undefined) { renderWith.contacts.push({ target: req.session.email }) }
								apiRoutes.listNotifications(cassandra, domainName, false)
								    .then((checks) => {
									    for (let k = 0; k < checks.length; k++) {
										renderWith.records.push({ checkid: checks[k].idcheck, down: checks[k].notifydownafter, label: checks[k].name,
											up: checks[k].notifyupafter, target: checks[k].notifytarget, driver: checks[k].notifydriver });
									    }
									    res.send(Mustache.render(templates['listNotifications'], renderWith));
									})
								    .catch((e) => {
									    logger.error('failed listing checks for ' + userId);
									    logger.error(e);
									    renderWith['errormsg'] = 'failed listing notifications';
									    res.send(Mustache.render(templates['backendError'], renderWith));
									});
							    })
							.catch((e) => {
								logger.error('failed listing contacts for ' + userId);
								logger.error(e);
								if (req.session.email !== undefined) { renderWith.contacts.push({ target: req.session.email }) }
								apiRoutes.listNotifications(cassandra, domainName, false)
								    .then((checks) => {
									    for (let k = 0; k < checks.length; k++) {
										renderWith.records.push({ checkid: checks[k].idcheck, down: checks[k].notifydownafter,
											up: checks[k].notifyupafter, target: checks[k].notifytarget, driver: checks[k].notifydriver });
									    }
									    res.send(Mustache.render(templates['listNotifications'], renderWith));
									})
								    .catch((e) => {
									    logger.error('failed listing notifications for ' + userId);
									    logger.error(e);
									    renderWith['errormsg'] = 'failed listing notifications';
									    res.send(Mustache.render(templates['backendError'], renderWith));
									});
							    });
						});

				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing notifications');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input listing notifications' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input listing notifications'); }
			});
	    });
	app.post('/notifications/:domainName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-notifications-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'checks:ro')
				.then((userId) => {
					let domainName = req.params.domainName || false;
					apiRoutes.listNotifications(cassandra, domainName, false)
					    .then((checks) => { res.send(checks); })
					    .catch((e) => {
						    logger.error('failed listing notifications for ' + userId + ' ' + domainName);
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
			    logger.error('faulty input listing notifications');
			    logger.error(e);
			    res.status(400).send('invalid input listing notifications');
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
						name: params.recordName.toLowerCase() || false,
						priority: params.recordPriority || 10,
						setId: params.setId || params.recordName,
						target: params.recordTarget || false,
						ttl: params.recordTtl || 3600,
						type: params.recordType || 'A',
					    };
					apiRoutes.addRecord(cassandra, domainName, recordObject)
					    .then((record) => {
						    self._getPool(domainName)
							.then((pools) => {
								if (zonesQueues[pools.nsPool] !== undefined) {
								    logger.info('notifying ' + pools.nsPool + ' refresh workers to reload ' + domainName);
								    zonesQueues[pools.nsPool].createJob({ origin: domainName }).save();
								} else { logger.info('no queue running for ' + pools.nsPool + ' -- restart REQUIRED!'); }
								if (pools.nsPool !== pools.bkpPool) {
								    if (zonesQueues[pools.bkpPool] !== undefined) {
									logger.info('notifying ' + pools.bkpPool + ' refresh workers to reload ' + domainName);
									zonesQueues[pools.bkpPool].createJob({ origin: domainName }).save();
								    } else { logger.info('no queue running for ' + pools.bkpPool + ' -- restart REQUIRED!'); }
								}
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
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send(e); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input adding record' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input adding record'); }
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
						name: params.recordName.toLowerCase() || false,
						setId: params.setId || params.recordName,
						type: params.recordType || 'A'
					    };
					apiRoutes.delRecord(cassandra, userId, recordObject)
					    .then((record) => {
						    self._getPool(domainName)
							.then((pools) => {
								if (zonesQueues[pools.nsPool] !== undefined) {
								    logger.info('notifying ' + pools.nsPool + ' refresh workers to reload ' + domainName);
								    zonesQueues[pools.nsPool].createJob({ origin: domainName }).save();
								} else { logger.info('no queue running for ' + pools.nsPool + ' -- restart REQUIRED!'); }
								if (pools.nsPool !== pools.bkpPool) {
								    if (zonesQueues[pools.bkpPool] !== undefined) {
									logger.info('notifying ' + pools.bkpPool + ' refresh workers to reload ' + domainName);
									zonesQueues[pools.bkpPool].createJob({ origin: domainName }).save();
								    } else { logger.info('no queue running for ' + pools.bkpPool + ' -- restart REQUIRED!'); }
								}
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
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed dropping record' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed dropping record'); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input dropping record' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input dropping record'); }
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
						name: params.recordName.toLowerCase() || false,
						priority: params.recordPriority || 10,
						setId: params.setId || params.recordName,
						target: params.recordTarget || false,
						ttl: params.recordTtl || 3600,
						type: params.recordType || 'A',
					    };
					apiRoutes.addRecord(cassandra, domainName, recordObject)
					    .then((record) => {
						    self._getPool(domainName)
							.then((pools) => {
								if (zonesQueues[pools.nsPool] !== undefined) {
								    logger.info('notifying ' + pools.nsPool + ' refresh workers to reload ' + domainName);
								    zonesQueues[pools.nsPool].createJob({ origin: domainName }).save();
								} else { logger.info('no queue running for ' + pools.nsPool + ' -- restart REQUIRED!'); }
								if (pools.nsPool !== pools.bkpPool) {
								    if (zonesQueues[pools.bkpPool] !== undefined) {
									logger.info('notifying ' + pools.bkpPool + ' refresh workers to reload ' + domainName);
									zonesQueues[pools.bkpPool].createJob({ origin: domainName }).save();
								    } else { logger.info('no queue running for ' + pools.bkpPool + ' -- restart REQUIRED!'); }
								}
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
						    logger.error('failed editing record ' + params.recordName + ' for ' + userId + ' ' + domainName);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: e };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send(e); }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input editing record' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input editing record'); }
			});
	    });
	app.get('/records/:domainName/get/:recordName', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'get-record-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:ro')
				.then((userId) => {
					let domainName = params.domainName;
					let recordName = params.recordName.toLowerCase();
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
						    res.send(Mustache.render(templates['listRecords'], renderWith));
						})
					    .catch((e) => {
						    logger.error('failed listing records for ' + userId);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing records';
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching record');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input fetching record' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input editing record'); }
			});
	    });
	app.post('/records/:domainName/get/:recordName', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'get-record-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'records:ro')
				.then((userId) => {
					let domainName = params.domainName || false;
					let recordName = params.recordName.toLowerCase() || false;
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
								res.send(Mustache.render(templates['listRecords'], renderWith));
							    })
							.catch((e) => {
								logger.error('failed listing health checks rendering records index');
								logger.error(e);
								res.send(Mustache.render(templates['listRecords'], renderWith));
							    });
						})
					    .catch((e) => {
						    logger.error('failed listing records for ' + userId);
						    logger.error(e);
						    renderWith['errormsg'] = 'failed listing records';
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing records');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input listing records' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input listing records'); }
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
		if (process.env.LOCK_REGISTRATIONS !== undefined) {
		    res.status(500).send('registration disabled');
		} else {
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
						let renderWith = { confmsg: 'please confirm your email address, clicking the link we just sent you', previousis: '/login', previouslabel: 'Back to Login' };
						res.send(Mustache.render(templates['backendConfirmation'], renderWith));
					    })
					.catch((e) => {
						logger.error('failed registering user ' + username + ' (' + params.emailaddr + ') via ' + params.actualIP);
						logger.error(e);
						let renderWith = { username: req.session.username, errormsg: 'failed registering account' };
						res.send(Mustache.render(templates['backendError'], renderWith));
					    });
				}
			    })
			.catch((e) => {
				logger.error('invalid input registering account');
				logger.error(e);
				res.redirect('/login');
			    });
		}
	    });

	app.get('/settings/2fa/confirm', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/2fa/confirm', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, '2fa-confirm')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.confirm2fa(cassandra, userId, params.confirmation)
					    .then((resp) => {
						    if (req.session.username !== undefined) { res.redirect('/settings'); }
						    else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed confirming 2fa for ' + userId);
						    logger.error(e);
						    let renderWith = { username: req.session.username, errormsg: '2fa configuration failed' };
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input confirming 2fa');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input confirming 2fa configuration' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input confirming 2fa'); }
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
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.enable2fa(cassandra, userId)
					    .then((token) => {
						    if (req.session.username !== undefined) {
							QRCode.toDataURL(token.otpauth_url, function(err, data_url) {
								if (err) {
								    let renderWith = { username: req.session.username, email: req.session.email, userid: userId, notifyFail: '', notifySuccess: '', twofadata: '<b>failed to enable</b>', logindata: [], contacts: [ { target: req.session.email } ] };
								    res.send(Mustache.render(templates['settings'], renderWith));
								} else {
								    let renderWith = { username: req.session.username, email: req.session.email, userid: userId, twofaurl: data_url, logindata: [], contacts: [ { target: req.session.email } ] };
								    res.send(Mustache.render(templates['enable2fa'], renderWith));
								}
							    });
						    } else { res.send(token.otpauth_url); }
						})
					    .catch((e) => {
						    logger.error('failed enabling 2fa for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed enabling 2FA' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed enabling 2FA'); }
						});
					})
				    .catch((e) => {
					    logger.error('failed authenticating user from ' + params.actualIP);
					    logger.error(e);
					    res.redirect('/login');
					});
			})
		    .catch((e) => {
			    logger.error('faulty input enabling 2fa');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input enabling 2fa' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input enabling 2fa'); }
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
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.disable2fa(cassandra, userId, params.confirmation)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/settings'); }
						    else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed disabling 2fa for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed disabling 2FA' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed disabling 2FA'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input disabling 2fa');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input disabling 2fa' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input disabling 2fa'); }
			});
	    });
	app.get('/settings/2fa/dropbackup', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/2fa/dropbackup', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, '2fa-drop-backup')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.disableBackupCodes(cassandra, userId, params.confirmation)
					    .then((codes) => {
						    if (req.session.username !== undefined) { res.redirect('/settings'); }
						    else { res.send('OK'); }
						})
					    .catch((e) => {
						    logger.error('failed purging 2fa backup codes for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed purging 2FA backup codes' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed purging 2FA backup codes'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input purging 2fa backup codes');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input purging 2fa backup codes' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input purging 2fa backup codes'); }
			});
	    });
	app.get('/settings/2fa/genbackup', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/2fa/genbackup', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, '2fa-gen-backup')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.enableBackupCodes(cassandra, userId, params.confirmation)
					    .then((codes) => {
						    if (req.session.username !== undefined) {
							res.set({ 'Content-Disposition': 'attachment; filename="OTP-highwaytohell-' + req.session.username + '.txt"' });
							res.send(codes.join('\n'));
						    } else { res.send(codes); }
						})
					    .catch((e) => {
						    logger.error('failed generating 2fa backup codes for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed generating 2FA backup codes' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed generating 2FA backup codes'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input generating 2fa backup codes');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input generating 2fa backup codes' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input generating 2fa backup codes'); }
			});
	    });
	app.post('/settings/confirm-address', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'confirm-address-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.confirmContact(cassandra, userId, params.confirmCode)
					    .then((confirmed) => {
						    logger.info('contact registration complete for ' + userId);
						    let renderWith = { confmsg: 'address confirmed', previousis: '/settings/contacts', previouslabel: 'Back to Contacts' };
						    res.send(Mustache.render(templates['backendConfirmation'], renderWith));
						})
					    .catch((e) => {
						    logger.error('failed confirming address');
						    logger.error(e);
						    let renderWith = { username: req.session.username || 'unknown', errormsg: e };
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input confirming address');
			    logger.error(e);
			    let renderWith = { username: req.session.username || 'unknown', errormsg: 'unable to confirm address' };
			    res.send(Mustache.render(templates['backendError'], renderWith));
			});
	    });
	app.get('/settings/confirm-address/:userId/:token', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'confirm-address-get')
		    .then((params) => {
			    apiRoutes.confirmAddress(cassandra, params.userId, params.token)
				.then((confirmed) => {
					logger.info('user ' + params.userId + ' registration complete');
					let renderWith = { confmsg: 'address confirmed', previousis: '/login', previouslabel: 'Back to Login' };
					res.send(Mustache.render(templates['backendConfirmation'], renderWith));
				    })
				.catch((e) => {
					logger.error('failed confirming address');
					logger.error(e);
					let renderWith = { username: 'unknown', errormsg: e };
					res.send(Mustache.render(templates['backendError'], renderWith));
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input confirming address');
			    logger.error(e);
			    let renderWith = { username: 'unknown', errormsg: 'unable to confirm address' };
			    res.send(Mustache.render(templates['backendError'], renderWith));
			});
	    });
	app.get('/settings/confirm-contact/:userId/:token', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'confirm-address')
		    .then((params) => {
			    apiRoutes.confirmContact(cassandra, params.userId, params.token)
				.then((confirmed) => {
					logger.info('contact ' + params.userId + ' registration complete');
					let renderWith = { confmsg: 'address confirmed', previousis: '/settings/contacts', previouslabel: 'Back to Contacts' };
					res.send(Mustache.render(templates['backendConfirmation'], renderWith));
				    })
				.catch((e) => {
					logger.error('failed confirming address');
					logger.error(e);
					let renderWith = { username: 'unknown', errormsg: e };
					res.send(Mustache.render(templates['backendError'], renderWith));
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input confirming address');
			    logger.error(e);
			    let renderWith = { username: 'unknown', errormsg: 'unable to confirm address' };
			    res.send(Mustache.render(templates['backendError'], renderWith));
			});
	    });
	app.get('/settings/contacts/add', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/contacts/add', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-contact')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.addContact(cassandra, userId, req.session.username, params.contactType, params.contactTarget)
					    .then((resp) => {
						    if (req.session.username !== undefined) {
							let renderWith = { confmsg: 'please confirm your email address, clicking the link we just sent you', previousis: '/settings/contacts', previouslabel: 'Back to Contacts' };
							res.send(Mustache.render(templates['backendConfirmation'], renderWith));
						    } else { res.send('check your emails'); }
						})
					    .catch((e) => {
						    logger.error('failed adding contact address ' + params.contactTarget + ' for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed adding contact' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed adding contact'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input adding contact address');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input adding contact' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input adding contact'); }
			});
	    });
	app.get('/settings/contacts/del', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/contacts/del', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'del-contact')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					apiRoutes.delContact(cassandra, userId, params.contactTarget)
					    .then((resp) => {
						    if (req.session.username !== undefined) { res.redirect('/settings/contacts'); }
						    else { res.send(resp); }
						})
					    .catch((e) => {
						    logger.error('failed dropping contact address ' + params.contactTarget + ' for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed dropping contact' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed dropping contact'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input dropping contact address');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input dropping contact' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input dropping contact'); }
			});
	    });
	app.post('/settings/contacts', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'list-contacts-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:ro')
				.then((userId) => {
					apiRoutes.listContacts(cassandra, userId)
					    .then((contacts) => {
						    let retWith = [];
						    for (let k = 0; k < contacts.length; k++) {
							let isActive = (contacts[k].confirmcode !== 'true') ? 'pending confirmation' : 'confirmed';
							retWith.push({ type: contacts[k].type, target: contacts[k].target, active: isActive });
						    }
						    res.send(retWith);
						})
					    .catch((e) => {
						    logger.error('failed listing contacts for ' + userId);
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
			    logger.error('faulty input listing contacts');
			    logger.error(e);
			    res.status(400).send('invalid input listing contacts');
			});
	    });
	app.get('/settings/contacts', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'list-contacts-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:ro')
				.then((userId) => {
					apiRoutes.listContacts(cassandra, userId)
					    .then((contacts) => {
						    let renderWith = { username: req.session.username, records: [] };
						    for (let k = 0; k < contacts.length; k++) {
							let isActive = "<div id='good'>yes</div>";
							if (contacts[k].confirmcode !== 'true') {
							    isActive = "<div id='bad'><a onclick='confirmContact(\"" + contacts[k].target + "\");' href='#'>pending confirmation</a></div>";
							}
							renderWith.records.push({ type: contacts[k].type, target: contacts[k].target, active: isActive });
						    }
						    res.send(Mustache.render(templates['listContacts'], renderWith));
						})
					    .catch((e) => {
						    logger.error('failed listing contacts for ' + userId);
						    logger.error(e);
						    let renderWith = { username: req.session.username, errormsg: 'failed listing contacts' };
						    res.send(Mustache.render(templates['backendError'], renderWith));
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing contacts');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input listing contacts' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input listing contacts'); }
			});
	    });
	app.get('/settings/logs', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/logs', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'logs')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:ro')
				.then((userId) => {
					apiRoutes.listLogins(cassandra, userId)
					    .then((resp) => { res.send(resp); })
					    .catch((e) => {
						    logger.error('failed listing authentication logs for ' + userId);
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
			    logger.error('faulty input fetching logs');
			    logger.error(e);
			    res.status(400).send('invalid input fetching logs');
			});
	    });
	app.get('/settings/notify/login', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/notify/login', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'login-notifications')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					let what = (params.logFailure !== undefined) ? 'notifyfailed' : 'notifylogin';
					let value = what === 'notifyfailed' ? params.logFailure : params.logSuccess;
					apiRoutes.updateLoginNotification(cassandra, userId, what, value)
					    .then((resp) => {
						    if (req.session.username !== undefined) { res.redirect('/settings'); }
						    else { res.send(resp); }
						})
					    .catch((e) => {
						    logger.error('failed updating login notification settings for ' + userId);
						    logger.error(e);
						    if (req.session.username !== undefined) {
							let renderWith = { username: req.session.username, errormsg: 'failed updating login notification settings' };
							res.send(Mustache.render(templates['backendError'], renderWith));
						    } else { res.status(500).send('failed updating login notification settings'); }
						});
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.status(401).send('authentication failed');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input updating login notification settings');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input updating login notification settings' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input updating login notification settings'); }
			});
	    });
	app.get('/settings/tokens/add', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/tokens/add', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'add-token')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:rw')
				.then((userId) => {
					cperms = new String(params.tokenPerms || '*').replace(/ /g, '');
					csrc = new String(params.tokenSourceFlt || '*').replace(/ /g, '');
					let tokenObject = { perms: cperms, src: csrc };
					apiRoutes.addToken(cassandra, userId, tokenObject)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/settings/tokens'); }
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
	app.get('/settings/tokens/edit', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/tokens/edit', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'edit-token')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:rw')
				.then((userId) => {
					cperms = new String(params.tokenPerms || '*').replace(/ /g, '');
					csrc = new String(params.tokenSourceFlt || '*').replace(/ /g, '');
					let tokenObject = { id: params.tokenId, perms: cperms, src: csrc };
					apiRoutes.editToken(cassandra, userId, tokenObject)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/settings/tokens'); }
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
	app.get('/settings/tokens/del', (req, res) => {
		getProbe.mark();
		res.status(500).send('please use POST whenever requesting a resources requiring authentication');
	    });
	app.post('/settings/tokens/del', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'del-token')
		    .then((params) => {
			    authValidation(cassandra, req, 'tokens:rw')
				.then((userId) => {
					apiRoutes.delToken(cassandra, userId, params.tokenString)
					    .then((token) => {
						    if (req.session.username !== undefined) { res.redirect('/settings/tokens'); }
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
	app.post('/settings/tokens', (req, res) => {
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
	app.get('/settings/tokens', (req, res) => {
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
						    res.send(Mustache.render(templates['tokens'], renderWith));
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
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input listing tokens');
			    logger.error(e);
			    res.status(400).send('invalid input listing tokens');
			});
	    });
	app.post('/settings', (req, res) => {
		postProbe.mark();
		cmdValidation(req, res, 'settings-post')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:rw')
				.then((userId) => {
					if (params.email !== req.session.email && params.email !== "") {
					    apiRoutes.updateAddress(cassandra, userId, params.email)
						.then((resp) => {
							if (req.session.username !== undefined) {
							    req.session.email = params.email;
							    res.redirect('/settings');
							} else { res.send(resp); }
						    })
						.catch((e) => {
							logger.error('failed editing email address for ' + userId);
							logger.error(e);
							if (req.session.username !== undefined) {
							    let renderWith = { username: req.session.username, errormsg: 'failed editing email address' };
							    res.send(Mustache.render(templates['backendError'], renderWith));
							} else { res.status(500).send('failed editing email address'); }
						    });
					} else if (params.password !== undefined) {
					    if (params.password !== params.passwordConfirm) {
						logger.error('mismatching input editing password for ' + userId);
						if (req.session.username !== undefined) {
						    let renderWith = { username: req.session.username, errormsg: 'mismatching input editing password' };
						    res.send(Mustache.render(templates['backendError'], renderWith));
						} else { res.status(400).send('mismatching input editing password'); }
					    } else {
						apiRoutes.updatePassword(cassandra, userId, params.password)
							.then((resp) => {
								if (req.session.username !== undefined) { res.redirect('/settings'); }
								else { res.send(resp); }
							    })
							.catch((e) => {
								logger.error('failed editing password for ' + userId);
								logger.error(e);
								if (req.session.username !== undefined) {
								    let renderWith = { username: req.session.username, errormsg: 'failed editing password' };
								    res.send(Mustache.render(templates['backendError'], renderWith));
								} else { res.status(500).send('failed editing password'); }
							    });
					    }
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
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input editing settings' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input editing settings'); }
			});
	    });
	app.get('/settings', (req, res) => {
		getProbe.mark();
		cmdValidation(req, res, 'settings-get')
		    .then((params) => {
			    authValidation(cassandra, req, 'settings:ro')
				.then((userId) => {
				    let disable2fa = "<table align='center'><tr><td><img src='/static/healthy.png' height='20px' width='20px' alt='enabled'/></td><td width='10%'>&nbsp;</td>"
						    + "<td><a onclick='forgetBackupCodes();' href='#'>Forget potentially-existing backup codes</a><br/>"
						    + "or <a class='good' onclick='regenBackupCodes();' href='#'>Generate and Download a new set of backup codes</a><br/>"
						    + "or <a class='bad' onclick='drop2FA();' href='#'>Disable 2FA authentication</a></td></tr></table>";
				    let enable2fa = "<table align='center'><tr><td><img src='/static/unhealthy.png' height='20px' width='20px' alt='disabled'/>"
						    + "</td><td width='10%'>&nbsp;</td><td><form method='post' action='/settings/2fa/enable'>"
						    + "<input type='submit' value='Enable 2FA'/>"
						    + "</form><br/>If you do not use some 2FA authenticator already,<br/>you may try <i><a href='/2fa-app' target='_blank'>Authy</a></i></td></tr></table>";
				    let renderWith = { username: req.session.username, email: req.session.email, userid: userId, logindata: [], contacts: [] };
				    apiRoutes.getUser(cassandra, userId)
					.then((resp) => {
						let logFail = resp.logFail;
						let logSuccess = resp.logSuccess;
						let labelFail =  (logFail ? 'Do not notify on failed logins' : 'Notify on failed logins');
						let labelSuccess =  (logSuccess ? 'Do not notify on successfull logins' : 'Notify on successfull logins');
						let statFail = (logFail ? "<div class='good'>Notifying on failed logins</div>" : "<div class='bad'>Not notifying on failed logins</div>");
						let statSuccess = (logSuccess ? "<div class='good'>Notifying on successfull logins</div>" : "<div class='bad'>Not notifying on successfull logins</div>");
						renderWith.notifyFail = statFail + "<form method='post' action='/settings/notify/login'><input type='hidden' name='logFailure' value='" + (!logFail) + "'/><input type='submit' value='" + labelFail + "'/></form>";
						renderWith.notifySuccess = statSuccess + "<form method='post' action='/settings/notify/login'><input type='hidden' name='logSuccess' value='" + (!logSuccess) + "'/><input type='submit' value='" + labelSuccess + "'/></form>";
						renderWith.twofadata = (resp.enabled === true ? disable2fa : enable2fa);
						apiRoutes.listContacts(cassandra, userId)
						    .then((contacts) => {
							    if (contacts.length > 0) {
								for (let k = 0; k < contacts.length; k++) {
								    if (contacts[k].type === 'smtp' && contacts[k].confirmcode === 'true') { renderWith.contacts.push({ target: contacts[k].target }); }
								}
							    }
							    if (renderWith.contacts.length === 0) { renderWith.contacts.push({ target: req.session.email }); }
							    apiRoutes.listLogins(cassandra, userId)
								.then((loginhistory) => {
									for (let k = 0; k < loginhistory.length; k++) {
									    let whenString = new Date(Math.round(loginhistory[k].time)).toISOString();
									    let successString = (loginhistory[k].succeeded === true) ? 'healthy' : 'unhealthy';
									    renderWith.logindata.push({ time: whenString, clientip: loginhistory[k].clientip, succeeded: successString });
									}
									res.send(Mustache.render(templates['settings'], renderWith));
								    })
								.catch((e) => {
									logger.error('failed listing logins for ' + userId);
									logger.error(e);
									renderWith.logindata.push({ time: '', clientip: 'failed querying logins history', succeeded: 'unhealthy' });
									res.send(Mustache.render(templates['settings'], renderWith));
								    });
							})
						    .catch((e) => {
							    logger.error('failed listing contacts rendering settings for ' + userId);
							    logger.error(e);
							    renderWith.contacts.push({ target: req.session.email });
							    apiRoutes.listLogins(cassandra, userId)
								.then((loginhistory) => {
									for (let k = 0; k < loginhistory.length; k++) {
									    let whenString = new Date(Math.round(loginhistory[k].time)).toISOString();
									    let successString = (loginhistory[k].succeeded === true) ? 'healthy' : 'unhealthy';
									    renderWith.logindata.push({ time: whenString, clientip: loginhistory[k].clientip, succeeded: successString });
									}
									res.send(Mustache.render(templates['settings'], renderWith));
								    })
								.catch((e) => {
									logger.error('failed listing logins for ' + userId);
									logger.error(e);
									renderWith.logindata.push({ time: '', clientip: 'failed querying logins history', succeeded: 'unhealthy' });
									res.send(Mustache.render(templates['settings'], renderWith));
								    });
							});
					    })
					.catch((e) => {
						logger.error('failed to checkout 2fa status for ' + userId);
						logger.error(e);
						renderWith.twofadata = enable2fa;
						res.send(Mustache.render(templates['settings'], renderWith));
					    });
				    })
				.catch((e) => {
					logger.error('failed authenticating user from ' + params.actualIP);
					logger.error(e);
					res.redirect('/login');
				    });
			})
		    .catch((e) => {
			    logger.error('faulty input fetching settings');
			    logger.error(e);
			    if (req.session.username !== undefined) {
				let renderWith = { username: req.session.username, errormsg: 'invalid input fetching settings' };
				res.send(Mustache.render(templates['backendError'], renderWith));
			    } else { res.status(400).send('invalid input fetching settings'); }
			});
	    });
    }
