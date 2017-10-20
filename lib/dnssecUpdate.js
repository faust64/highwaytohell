const Promise = require('bluebird');
const cst = require('./cassandra.js');
const fs = require('fs');
const lookupDnssecKeys = 'SELECT * from dnsseckeys WHERE ksk = ? AND zsk = ?';
const nsRootDir = process.env.NS_ROOT_DIR || '.';
const nsKeysDir = process.env.NS_KEYS_DIR || (nsRootDir + '/keys.d');

module.exports = (cassandra, domain) => {
	return new Promise((resolve, reject) => {
		this._log = require('./logger.js')('dnssec-update');
		let self = this;
		if (domain.ksk !== undefined && domain.ksk !== null && domain.zsk !== undefined && domain.zsk !== null) {
		    cassandra.execute(lookupDnssecKeys, [ domain.ksk, domain.zsk ], cst.readConsistency())
			.then((resp) => {
				if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				    let compareKsk = {}, compareZsk = {}, needUpdate = true;

				    try {
					compareKsk['key'] = Buffer(fs.readFileSync(nsKeysDir + '/' + domain.ksk + '.key'), 'ascii');
					compareKsk['private'] = Buffer(fs.readFileSync(nsKeysDir + '/' + domain.ksk + '.private'), 'ascii');
					compareZsk['key'] = Buffer(fs.readFileSync(nsKeysDir + '/' + domain.zsk + '.key'), 'ascii');
					compareZsk['private'] = Buffer(fs.readFileSync(nsKeysDir + '/' + domain.zsk + '.private'), 'ascii');
					if (Buffer.compare(Buffer.from(resp.rows[0].kskkey.toString(), 'base64'), compareKsk['key']) === 0) {
					    if (Buffer.compare(Buffer.from(resp.rows[0].kskprivate.toString(), 'base64'), compareKsk['private']) === 0) {
						if (Buffer.compare(Buffer.from(resp.rows[0].zskkey.toString(), 'base64'), compareZsk['key']) === 0) {
						    if (Buffer.compare(Buffer.from(resp.rows[0].zskprivate.toString(), 'base64'), compareZsk['private']) === 0) {
							needUpdate = false;
						    }
						}
					    }
					}
				    } catch(e) { self._log.info('could not read keys, refreshing local copy'); self._log.info(e); }
				    if (needUpdate) {
					try {
					    fs.writeFileSync(nsKeysDir + '/' + domain.ksk + '.key', Buffer.from(resp.rows[0].kskkey.toString(), 'base64').toString('ascii'));
					    fs.writeFileSync(nsKeysDir + '/' + domain.ksk + '.private', Buffer.from(resp.rows[0].kskprivate.toString(), 'base64').toString('ascii'));
					    fs.writeFileSync(nsKeysDir + '/' + domain.zsk + '.key', Buffer.from(resp.rows[0].zskkey.toString(), 'base64').toString('ascii'));
					    fs.writeFileSync(nsKeysDir + '/' + domain.zsk + '.private', Buffer.from(resp.rows[0].zskprivate.toString(), 'base64').toString('ascii'));
					    self._log.info('done refreshing local keys for ' + domain.origin);
					    resolve(true);
					} catch(e) {
					    self._log.info('failed writing keys for ' + domain.origin);
					    reject(false);
					}
				    } else {
					self._log.info('dnssec up-to-date for ' + domain.origin);
					resolve(true);
				    }
				} else {
				    self._log.info('dnssec not enabled on ' + domain.origin);
				    resolve(true);
				}
			    })
			.catch((e) => {
				self._log.info('failed querying cassandra for dnssec keys');
				reject(false);
			    });
		} else {
		    self._log.info('invalid input');
		    reject(false);
		}
	    });
    }
