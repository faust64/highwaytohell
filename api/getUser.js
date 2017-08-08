const Promise = require('bluebird');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let getUser = "SELECT enabled, secret FROM twofa WHERE uuid = '" + userId + "'";
		cassandra.execute(getUser)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				resolve(resp.rows[0]);
			    } else {
				resolve({ enabled: false, secret: '' });
			    }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
