const Promise = require('bluebird');

module.exports = (cassandra, userId, confirmation) => {
	return new Promise ((resolve, reject) => {
		    /*
		     * FIXME:
		     * should check confirmation code validity, prior to disabling 2FA auth
		     */
		let updateUser = "UPDATE twofa SET secret = null, enabled = false WHERE uuid = '" + userId + "'";
		cassandra.execute(updateUser)
		    .then((resp) => { resolve(true); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
