const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId, code) => {
	return new Promise ((resolve, reject) => {
		let dropSecrets = "DELETE FROM backupcodes WHERE uuid = '" + userId + "'";
		let get2fa = "SELECT secret FROM twofa WHERE uuid = '" + userId + "'";
		cassandra.execute(get2fa, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let validObject = { secret: resp.rows[0].secret.toString(), encoding: 'base32', token: code };
				if (require('speakeasy').totp.verify(validObject)) {
				    cassandra.execute(dropSecrets, [], { consistency: drv.types.consistencies.one })
					.then((dropped) => { resolve(true); })
					.catch((e) => { reject('failed purging previously-existing codes'); });
				} else { reject('wrong 2FA code'); }
			    } else { reject('2FA not configured'); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
