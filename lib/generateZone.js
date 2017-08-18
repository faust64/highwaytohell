const Promise = require('bluebird');
const crypto = require('crypto');
const exec = require('child_process').exec;
const fs = require('fs');

const defaultContactSoa = process.env.SOA_CONTACT || 'root.example.com';

const listRecordsFrom = 'SELECT * FROM records WHERE origin = ?';

const dnsCommands = {
	bind: {
	    basecmd: 'dnssec-signzone -A -3 ',
	    keysOpt: false,
	    key2ds: false,
	    checkzone: 'named-checkzone ',
	    zoneoption: ' -N INCREMENT -o ',
	    zonefileoption: ' -t'
	},
	nsd: {
	    basecmd: 'ldns-signzone -n -p -s ',
	    checkzone: 'nsd-checkzone ',
	    key2ds: 'ldns-key2ds -n ',
	    keysOpt: true,
	    zoneoption: ' -o ',
	    zonefileoption: ' '
	}
    };
const dnsDriver = process.env.DNS_DRIVER || 'nsd';
const nsRootDir = process.env.NS_ROOT_DIR || '.';
const nsKeysDir = process.env.NS_KEYS_DIR || (nsRootDir + '/keys.d');
const nsZonesDir = process.env.NS_ZONES_DIR || (nsRootDir + '/zones.d');

const execAsync = Promise.promisify(exec);

/*
 * if we do not instantiate a new object for each generation,
 * then generateHeaders is static, somehow.
 * this eventually leads to ORIGIN not matching the reft of our zone, ...
 * keep that contructor horror
 */
class GenerateZone {
    constructor(cassandra, zoneinfo, refreshSerial) {
	    return new Promise((resolve, reject) => {
		    this._log = require('./logger.js')('generate-zone');
		    let self = this;
		    let cmdSelector = dnsCommands[dnsDriver];
		    let serial = (refreshSerial !== true) ? zoneinfo.serial : Math.round(Date.now() / 10);
		    let formatRecord = function(rec) {
			    let buf = rec.name + ' ' + (rec.ttl || '14400') + ' IN ' + rec.type + ' ';
			    if (rec.type !== 'A' && rec.type !== 'CNAME' && rec.type !== 'TXT' && rec.type !== 'NS' && rec.type !== 'AAAA') {
				buf += (rec.priority || '10') + ' ';
			    }
			    buf += rec.target;
			    if (rec.target.match(/\.$/) === null) {
				if (rec.type === 'CNAME' || rec.type === 'PTR' || rec.type === 'NS' || rec.type === 'MX') {
				    buf += '.';
				}
			    }
			    return buf;
			};
		    let generateHeader = function(infos, ns1, ns2) {
			    let ret = [];
			    ret.push('$TTL 259200');
			    ret.push('@ SOA ' + ns1 + ' ' + defaultContactSoa + ' (');
			    ret.push('		' + serial);
			    ret.push('		' + (infos.refresh || 28800));
			    ret.push('		' + (infos.failrefresh || 7200));
			    ret.push('		' + (infos.authrefresh || 604800));
			    ret.push('		' + (infos.negrefresh || 600) + ' )');
			    ret.push('$ORIGIN ' + infos.origin + '.');
			    ret.push('@ IN NS ' + ns1 + '.');
			    if (ns1 !== ns2)  { ret.push('@ IN NS ' + ns2 + '.'); }
			    if (infos.ksk !== undefined && infos.ksk !== null) { ret.push(fs.readFileSync(nsKeysDir + '/' + infos.ksk + '.key')); }
			    if (infos.zsk !== undefined && infos.zsk !== null) { ret.push(fs.readFileSync(nsKeysDir + '/' + infos.zsk + '.key')); }
			    return ret;
			};
		    if (process.env.DEBUG) { cassandra.on('log', function(level, classname, msg, data) { self._log.info('log event: %s -- %s -- %s', level, msg, data); }); }
		    this._log.info('generating zone ' + zoneinfo.origin + ' orig serial: ' + zoneinfo.serial + ' refresh=' + refreshSerial);
		    let getNsPools = "SELECT fqdn FROM nspools WHERE tag IN ('" + zoneinfo.nspool + "', '" + zoneinfo.bkppool + "')";
		    cassandra.execute(getNsPools)
			.then((nsp) => {
				if (nsp.rows !== undefined && nsp.rows[0] !== undefined) {
				    let ns2 = (nsp.rows[1] !== undefined && nsp.rows[1].fqdn !== undefined) ? nsp.rows[1].fqdn : nsp.rows[0].fqdn;
				    this._buffer = generateHeader(zoneinfo, nsp.rows[0].fqdn, ns2);
				    cassandra.execute(listRecordsFrom, [ zoneinfo.origin ])
					.then(record => {
						let tmpFile = (process.env.TMPDIR || '/tmp' ) + '/db.' + zoneinfo.origin;
						let dstFile = nsZonesDir + '/db.' + zoneinfo.origin;
						if (record.rows !== undefined) {
						    let waitRecords = [];
						    record.rows.forEach(function(rec) {
							    waitRecords.push(new Promise((resolveDeep, rejectDeep) => {
								    if (rec.healthcheckid !== undefined || rec.healthcheckid === null) {
									if (process.env.DEBUG) { self._log.info('processing static ' + JSON.stringify(rec)); }
									self._buffer.push(formatRecord(rec));
									resolveDeep(true);
								    } else {
									if (process.env.DEBUG) { self._log.info('processing dynamic ' + JSON.stringify(rec)); }
									let checkCond = "SELECT * FROM checks WHERE uuid = '" + rec.healthcheckid + "'";
									cassandra.execute(checkCond)
									    .then(conditions => {
										    if (conditions.rows !== undefined) {
											if (conditions.rows.length > 0) {
											    let requireHealthy = conditions.rows[0].requirehealthy,
												requireUnhealthy = conditions.rows[0].requireunhealthy,
												maxLimit = requireHealthy > requireUnhealthy ? requireHealthy : requireUnhealthy,
												isHealthy = "SELECT * FROM checkhistory WHERE uuid = '" + rec.healthcheckid + "' ORDER BY when desc LIMIT " + maxLimit;
											    cassandra.execute(isHealthy)
												.then(check => {
													if (check.rows !== undefined) {
													    if (check.rows.length > 0) {
														let count = 0, recHealthy = false;
														for (let k = 0; k < check.rows.length; k++) {
														    if (check.rows[k].value === true) { count++; }
														    if ((k + 1) == requireUnhealthy && count === 0) { break; }
														    else if ((k + 1) >= requireHealthy && count >= requireHealthy) {
															recHealthy = true;
															break;
														    }
														}
														if (recHealthy) { self._buffer.push(formatRecord(rec)); }
													    } else { self._log.info('no history for check UUID:' + rec.healthcheckid); }
													} else { self._log.info('failed listing health check history, cassandra returned ' + JSON.stringify(check)); }
													resolveDeep(true);
												    })
												.catch((e) => {
													self._log.error('failed querying cassandra about check UUID ' + rec.healthcheckid);
													self._log.error(e);
													resolveDeep(true);
												    });
											} else { self._log.info('no conditions defined for check UUID:' + rec.healthcheckid); resolveDeep(true); }
										    } else { self._log.info('failed listing health check conditions, cassandra returned ' + JSON.stringify(conditions)); resolveDeep(true); }
										})
									    .catch((e) => {
										    self._log.error('failed looking up health check conditions for UUID ' + rec.healthcheckid);
										    self._log.error(e);
										    resolveDeep(true);
										});
								    }
								}));
							});
						    Promise.all(waitRecords)
							.then(() => {
								if (this._buffer.length > 0) {
								    return fs.writeFileSync(tmpFile, this._buffer.join('\n') + '\n', 'utf-8');
								} else { throw new Error('empty buffer'); }
							    })
							.then(() => {
								self._log.info('checking zone with ' + cmdSelector.checkzone + zoneinfo.origin + ' ' + tmpFile);
								return execAsync(cmdSelector.checkzone + zoneinfo.origin + ' ' + tmpFile)
								    .then(() => { self._log.info('zone ' + zoneinfo.origin + ' is valid'); })
								    .catch((e) => { self._log.error('zone check failed for ' + zoneinfo.origin); throw new Error('zone check failed'); });
							    })
							.then(() => {
								if (zoneinfo.zsk !== undefined && zoneinfo.zsk !== null && zoneinfo.ksk !== undefined && zoneinfo.ksk !== null) {
								    let token = crypto.randomBytes(16).toString('hex').slice(0, 16);
								    let signCommand = cmdSelector.basecmd + token + cmdSelector.zoneoption + zoneinfo.origin + cmdSelector.zonefileoption + tmpFile;
								    if (cmdSelector.keysOpt === true) { signCommand += ' ' + zoneinfo.ksk + ' ' + zoneinfo.zsk; }
								    self._log.info('signing with ' + signCommand);
								    execAsync(signCommand, { cwd: nsKeysDir })
									.then((signout) => {
										self._log.info('signed, now comparing ' + tmpFile + ' to ' + dstFile);
										return execAsync('cmp ' + tmpFile + ' ' + dstFile)
										    .then((cmpout) => {
											    self._log.info('no changes for ' + zoneinfo.origin);
											    let getSigned = "SELECT zonedata FROM signedzones WHERE origin = '" + zoneinfo.origin + "'";
											    cassandra.execute(getSigned)
												.then((resp) => {
													if (resp.rows !== undefined) {
													    let zoneData = Buffer.from(resp.rows[0].zonedata.toString(), 'base64');
													    fs.writeFileSync(tmpFile + '.signed', zoneData.toString('ascii'));
													    return execAsync('cmp ' + tmpFile + '.signed ' + dstFile + '.signed')
														.then(() => {
															self._log.info('signed zones match for ' + zoneinfo.origin);
															resolve(true);
														    })
														.catch((e) => {
															let installCommand = 'cp -p ' + tmpFile + '.signed ' + dstFile + '.signed';
															self._log.info('installing signed db with ' + installCommand);
															return execAsync(installCommand)
															    .then((installout) => {
																    self._log.info('installed new signed database for ' + zoneinfo.origin);
																    resolve(true);
																})
															    .catch((installerr) => {
																    self._log.error('failed installing signed zone from cassandra for ' + zoneinfo.origin);
																    reject(false);
																});
														    });
													} else {
													    self._log.error('failed querying cassandra for signed copy of ' + zoneinfo.origin);
													    reject(false);
													}
												    })
												.catch((e) => {
													self._log.error('failed fetching signed zone from cassandra');
													reject(false);
												    });
											})
										    .catch((e) => {
											    let signedZone = Buffer(fs.readFileSync(tmpFile + '.signed'), 'binary').toString('base64');
											    let insertZone = "UPDATE signedzones SET zonedata = ? WHERE origin = '" + zoneinfo.origin + "'";
											    cassandra.execute(insertZone, [ signedZone ])
												.then((insertResp) => {
													let tmpSig = (process.env.TMPDIR || '/tmp' ) + '/dsset-' + zoneinfo.origin;
													let gensigs = '';
													if (cmdSelector.key2ds !== false) {
													    gensigs = '( ' + cmdSelector.key2ds + '-1 ' + tmpFile + '.signed && '
															+ cmdSelector.key2ds + '-2 ' + tmpFile + '.signed ) >' + tmpSig;
													} else { gensigs = 'echo OK'; }
													self._log.info('signing with ' + gensigs);
													execAsync(gensigs, { cwd: nsKeysDir })
													    .then((gen) => {
														    if (fs.existsSync(tmpSig)) {
															let dsRec = fs.readFileSync(tmpSig);
															let insertDS = "UPDATE dsrecords SET ds = ? WHERE origin = '" + zoneinfo.origin + "'";
															cassandra.execute(insertDS, [ dsRec ])
															    .then((dsret) => {
																    let installCommand = 'cp -p ' + tmpFile + ' ' + dstFile + ' && cp -p ' + tmpFile + '.signed ' + dstFile + '.signed';
																    self._log.info('installing db with ' + installCommand);
																    return execAsync(installCommand)
																	.then((installout) => {
																		if (refreshSerial === true) {
																		    self._log.info('installed new database for ' + zoneinfo.origin + ', updating serial');
																		    let command = "UPDATE zones SET serial = '" + serial + "' WHERE origin = '" + zoneinfo.origin + "'";
																		    cassandra.execute(command)
																			.then((resp) => {
																				self._log.info('updated serial for ' + zoneinfo.origin);
																				resolve(true);
																			    })
																			.catch((e) => {
																				self._log.error('failed updating serial for ' + zoneinfo.origin + ' with: ' + JSON.stringify(e));
																				reject(false);
																			    });
																		} else {
																		    self._log.info('installed new database for ' + zoneinfo.origin);
																		    resolve(true);
																		}
																	    })
																	.catch((e) => {
																		self._log.error('failed installing new database for ' + zoneinfo.origin);
																		reject(false);
																	    });
																})
															    .catch((eds) => {
																    self._log.error('failed inserting DS record for ' + zoneinfo.origin);
																    self._log.error(e);
																    reject(false);
																});
														    } else {
															self._log.error('missing DS record for ' + zoneinfo.origin);
															self._log.error(e);
															reject(false);
														    }
														})
													    .catch((esig) => {
														    self._log.error('failed extracting DS record for ' + zoneinfo.origin);
														    self._log.error(e);
														    reject(false);
														});
												    })
												.catch((e) => {
													self._log.error('failed inserting signed zone data for ' + zoneinfo.origin);
													self._log.error(e);
													reject(false);
												    });
											});
									    })
									.catch((e) => {
										self._log.error('failed signing ' + zoneinfo.origin);
										self._log.error(e);
										reject(false);
									    });
								} else {
								    return execAsync('cmp ' + tmpFile + ' ' + dstFile)
									.then((cmpout) => {
										self._log.info('zone ' + zoneinfo.origin + ' is up to date at #' + serial);
										resolve(true);
									    })
									.catch((e) => {
										return execAsync('cp -p ' + tmpFile + ' ' + dstFile)
										    .then((installout) => {
											    if (refreshSerial === true) {
												self._log.info('installed new database for ' + zoneinfo.origin + ', updating serial');
												let command = "UPDATE zones SET serial = '" + serial + "' WHERE origin = '" + zoneinfo.origin + "'";
												cassandra.execute(command)
												    .then((resp) => {
													    self._log.info('updated serial for ' + zoneinfo.origin);
													    resolve(true);
													})
												    .catch((casserror) => {
													    self._log.error('failed updating serial for ' + zoneinfo.origin + ' with: ' + JSON.stringify(caserror));
													    reject(false);
													});
											    } else {
												self._log.info('installed new database for ' + zoneinfo.origin);
												resolve(true);
											    }
											})
										    .catch((e) => {
											    self._log.error('failed installing new database for ' + zoneinfo.origin);
											    reject(false);
											});
									    });
								}
							    })
							.catch((e) => {
								self._log.error('not installing zone for ' + zoneinfo.origin);
								self._log.error(e);
								resolve(true);
							    });
						} else {
						    self._log.error('failed listing records, cassandra returned ' + JSON.stringify(record));
						    reject(false);
						}
					    })
					.catch(e => {
						self._log.error('failed generating ' + zoneinfo.origin + ' with error ' + JSON.stringify(e));
						reject(false);
					    });
				} else {
				    self._log.error('missing nspool records for ' + zoneinfo.origin);
				    reject(false);
				}
			    })
			.catch((e) => {
				self._log.error('failed querying nspool records from cassandra generating ' + zoneinfo.origin);
				reject(false);
			    });
		});
	}
}

exports.GenerateZone = GenerateZone;
