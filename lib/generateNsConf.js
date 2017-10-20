const Promise = require('bluebird');
const cst = require('./cassandra.js');
const exec = require('child_process').exec;
const fs = require('fs');
const generateZone = require('./generateZone.js');

const dnsDriver = process.env.DNS_DRIVER || 'nsd';
const dnsChrooted = process.env.DNS_CHROOT || false;
const nsRootDir = process.env.NS_ROOT_DIR || '.';
const nsZonesDir = process.env.NS_ZONES_DIR || (nsRootDir + '/zones.d');
const workerPool = process.env.HWTH_POOL || 'default';
const dnsCommands = {
	bind: { check: 'named-checkconf named.conf' },
	nsd: { check: 'nsd-checkconf nsd.conf' }
    };

const execAsync = Promise.promisify(exec);

module.exports = (cassandra) => {
	return new Promise((resolve, reject) => {
		this._log = require('./logger.js')('generate-ns-conf');
		let listZones = "SELECT * FROM zones WHERE nspool = '" + workerPool + "'";
		let self = this;
		const renderDnssecZone = function(domain) {
			let ret = '';
			if (dnsDriver === 'nsd') {
			    ret = 'zone:\n';
			    ret += '    name: ' + domain + '\n';
			    ret += '    zonefile: db.' + domain+ '.signed\n';
			} else if (dnssecDriver === 'bind') {
			    ret = 'zone "' + domain + '" {\n';
			    ret += '    type master;\n';
			    if (dnsChrooted) {
				ret += '    file "db.' + domain+ '.signed";\n';
			    } else {
				ret += '    file "' + nsZonesDir + '/db.' + domain+ '.signed";\n';
			    }
			}
			return ret;
		    };
		const renderDnsZone = function(domain) {
			let ret = '';
			if (dnsDriver === 'nsd') {
			    ret = 'zone:\n';
			    ret += '    name: ' + domain + '\n';
			    ret += '    zonefile: db.' + domain+ '\n';
			} else if (dnssecDriver === 'bind') {
			    ret = 'zone "' + domain + '" {\n';
			    ret += '    type master;\n';
			    if (dnsChrooted) {
				ret += '    file "db.' + domain+ '";\n';
			    } else {
				ret += '    file "' + nsZonesDir + '/db.' + domain+ '";\n';
			    }
			}
			return ret;
		    };
		cassandra.execute(listZones, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined) {
				let buffer = '';
				let zonesGen = [];
				for (let j = 0; j < resp.rows.length; j++) {
				    if (resp.rows[j].ksk !== undefined && resp.rows[j].ksk !== null && resp.rows[j].zsk !== undefined && resp.rows[j].zsk !== null) {
					buffer += renderDnssecZone(resp.rows[j].origin);
				    } else { buffer += renderDnsZone(resp.rows[j].origin); }
				    zonesGen.push(new generateZone.GenerateZone(cassandra, resp.rows[j], false));
				}
				try {
				    let dfile = (dnsDriver === 'nsd' ? nsRootDir + '/nsd.conf.d' : nsRootDir) + '/highwaytohell-zones.conf';
				    fs.writeFileSync(dfile, buffer);
				    self._log.info('wrote ' + dnsDriver + ' zones configuration');
				    Promise.all(zonesGen)
					.then((generated) => {
						self._log.info('generated local zones');
						return execAsync(dnsCommands[dnsDriver].check, { cwd: nsRootDir })
						    .then(() => {
							    self._log.info(dnsDriver + ' configuration check passed, marking for reload');
							    let markFile = nsZonesDir + '/.hwth-serial';
							    fs.writeFileSync(markFile, Date.now());
							    resolve(true);
							})
						    .catch((e) => {
							    self._log.error('failed checking ' + dnsDriver + ' configuration');
							    self._log.error(e);
							    reject(false);
							});
					    })
					.catch((egen) => {
						self._log.error('failed generating local zones configuration');
						self._log.error(egen);
						reject(false);
					    })
				} catch(e) {
				    self._log.error('failed writing ' + dnsDriver + ' zones configuration');
				    self._log.error(e);
				    reject(false);
				}
			    } else {
				self._log.error('failed querying cassandra generating initial configuration');
				self._log.error(resp);
				reject(false);
			    }
			})
		    .catch((e) => {
			    self._log.error('failed querying cassandra generating initial configuration');
			    self._log.error(e);
			    reject(false);
			});
	    });
    };
