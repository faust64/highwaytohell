const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let getSettings = "SELECT notifyfailed, notifylogin FROM users WHERE uuid = '" + userId + "'";
		let getUser = "SELECT enabled, secret FROM twofa WHERE uuid = '" + userId + "'";
		cassandra.execute(getSettings, [], { consistency: drv.types.consistencies.one })
		    .then((stgs) => {
			    let notifySuccess = false, notifyFail = false;
			    if (stgs.rows !== undefined && stgs.rows[0] !== undefined) {
				notifySuccess = stgs.rows[0].notifylogin;
				notifyFail = stgs.rows[0].notifyfailed;
			    }
			    cassandra.execute(getUser, [], { consistency: drv.types.consistencies.one })
				.then((resp) => {
					if (resp.rows !== undefined && resp.rows[0] !== undefined) {
					    resolve({ enabled: resp.rows[0].enabled, secret: resp.rows[0].secret, logSuccess: notifySuccess, logFail: notifyFail });
					} else { resolve({ enabled: false, secret: '', logSuccess: notifySuccess, logFail: notifyFail }); }
				    })
				.catch((e) => { reject('failed querying cassandra for 2FA data'); });
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
