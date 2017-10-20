const Promise = require('bluebird');
const cst = require('../lib/cassandra.js');
const exec = require('child_process').exec;
const fs = require('fs');

const dnssecCommands = {
	bind: {
	    kskbasecmd: 'dnssec-keygen -f KSK -a NSEC3RSASHA1 -b 2048 -n ZONE ',
	    zskbasecmd: 'dnssec-keygen -a NSEC3RSASHA1 -b 2048 -n ZONE '
	},
	nsd: {
	    kskbasecmd: 'ldns-keygen -r /dev/urandom -k -a RSASHA1-NSEC3-SHA1 -b 2048 ',
	    zskbasecmd: 'ldns-keygen -r /dev/urandom -a RSASHA1-NSEC3-SHA1 -b 2048 '
	}
    };
const dnssecDriver = process.env.DNS_DRIVER || 'nsd';
const nsRootDir = process.env.NS_ROOT_DIR || '.';
const nsKeysDir = process.env.NS_KEYS_DIR || (nsRootDir + '/keys.d');

const execAsync = Promise.promisify(exec);

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		this._log = require('../lib/logger.js')('dnssec-init');
		let self = this;
		let cmdSelector = dnssecCommands[dnssecDriver];
		let zsk = '', ksk = '', kskObj = {}, zskObj = {};
		return execAsync(cmdSelector.zskbasecmd + domain, { cwd: nsKeysDir })
		    .then((zskout) => {
			    zsk = zskout.replace(/\n$/, '');
			    zskObj = {
				    key: Buffer(fs.readFileSync(nsKeysDir + '/' + zsk + '.key'), 'binary').toString('base64'),
				    priv: Buffer(fs.readFileSync(nsKeysDir + '/' + zsk + '.private'), 'binary').toString('base64')
				};
			    return execAsync(cmdSelector.kskbasecmd + domain, { cwd: nsKeysDir })
			})
		    .then((kskout) => {
			    ksk = kskout.replace(/\n$/, '');
			    kskObj = {
				    key: Buffer(fs.readFileSync(nsKeysDir + '/' + ksk + '.key'), 'binary').toString('base64'),
				    priv: Buffer(fs.readFileSync(nsKeysDir + '/' + ksk + '.private'), 'binary').toString('base64')
				};
			    if (ksk !== '' && zsk !== '') {
				if (process.env.DEBUG) { self._log.info('generated zsk:' + zsk + ' & ksk:' + ksk); }
				let command = "UPDATE zones SET ksk = '" + ksk + "', zsk = '" + zsk + "' WHERE origin = '" + domain + "'";
				cassandra.execute(command, [], cst.writeConsistency())
				    .then((resp) => {
					    self._log.info('dnssec initialized for ' + domain);
					    let uploadDnssecKeys = 'INSERT INTO dnsseckeys (ksk, zsk, kskkey, kskprivate, zskkey, zskprivate) VALUES (?, ?, ?, ?, ?, ?)';
					    let uploadOptions = [ ksk, zsk, kskObj.key, kskObj.priv, zskObj.key, zskObj.priv ];
					    cassandra.execute(uploadDnssecKeys, uploadOptions, cst.writeConsistency())
						.then((respDeep) => {
							self._log.info('uploaded new keys for ' + domain);
							resolve(true);
						    })
						.catch((e) => {
							self._log.info('failed storing keys for ' + domain);
							reject('failed storing keys');
						    });
					})
				    .catch((e) => {
					    self._log.error('failed saving zsk & ksk values for ' + domain);
					    self._log.error(e);
					    reject('failed enabling DNSSEC on ' + domain);
					});
			    }
			})
		    .catch((e) => {
			    self._log.error('failed generating dnssec keys for ' + domain);
			    self._log.error(e);
			    reject('failed generating keys');
			});
	    });
    };
