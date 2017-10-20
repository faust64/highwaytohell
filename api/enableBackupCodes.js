const Promise = require('bluebird');
const crypto = require('crypto');
const cst = require('../lib/cassandra.js');

module.exports = (cassandra, userId, code) => {
	return new Promise ((resolve, reject) => {
		let addSecrets = [];
		let dropSecrets = "DELETE FROM backupcodes WHERE uuid = '" + userId + "'";
		let get2fa = "SELECT secret FROM twofa WHERE uuid = '" + userId + "'";
		cassandra.execute(get2fa, [], cst.readConsistency())
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let validObject = { secret: resp.rows[0].secret.toString(), encoding: 'base32', token: code };
				if (require('speakeasy').totp.verify(validObject)) {
				    crypto.randomBytes(128, function(e, buf) {
					    if (e) { reject('failed generating random'); }
					    else {
						let rsp = [], hexBuf = buf.toString('hex');
						for (let k = 0; k * 12 < hexBuf.length && rsp.length < 10; k++) {
						    let mightAdd = hexBuf.substr(k * 12, 12);
						    if (rsp.indexOf(mightAdd) < 0) {
							//FIXME: shouldn't we hash backup codes storing them into db?
							//on the other hand, no hash is probably the best way to prevent against collisions, ...
							rsp.push(mightAdd);
							addSecrets.push({ query: "INSERT INTO backupcodes (uuid, secret) VALUES ('" + userId + "', '" + mightAdd + "')" });
						    }
						}
						if (rsp.length >= 10) {
						    cassandra.execute(dropSecrets, [], cst.writeConsistency())
							.then((dropped) => {
								cassandra.batch(addSecrets, cst.writeConsistency())
								    .then((resp) => { resolve(rsp); })
								    .catch((e) => { reject('failed writing secrets to cassandra'); });
							    })
							.catch((e) => { reject('failed purging previous secrets from cassandra'); });
						} else { reject('failed generating backup codes'); }
					    }
					});
				} else { reject('wrong 2FA code'); }
			    } else { reject('2FA not configured'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
