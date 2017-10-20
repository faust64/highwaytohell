const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId, code) => {
	return new Promise ((resolve, reject) => {
		let get2fa = "SELECT secret FROM twofa WHERE uuid = '" + userId + "'";
		let updateUser = [
			{ query: "UPDATE twofa SET secret = null, enabled = false WHERE uuid = '" + userId + "'" },
			{ query: "DELETE FROM backupcodes WHERE uuid = '" + userId + "'" }
		    ];
		cassandra.execute(get2fa, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let validObject = { secret: resp.rows[0].secret.toString(), encoding: 'base32', token: code };
				if (require('speakeasy').totp.verify(validObject)) {
				    cassandra.batch(updateUser, { consistency: drv.types.consistencies.one })
					.then((dresp) => { resolve(true); })
					.catch((e) => { reject('failed disable 2FA authentication'); });
				} else { reject('failed confirming 2FA code'); }
			    } else { reject('failed resolving 2FA secret'); }
			})
		    .catch((e) => { reject('failed querying cassandra checking 2FA code'); });
	    });
    };
