const Promise = require('bluebird');

module.exports = (cassandra, userId, checkObject) => {
	return new Promise ((resolve, reject) => {
	    /*
		let dropCheck = "DELETE FROM checks WHERE uuid = '" + checkObject.uuid + "' AND origin = '"
			+ checkObject.origin + "' AND ownerid = '" + userId + "'";
	     */
		let dropCheck = "DELETE FROM checks WHERE uuid = '" + checkObject.uuid + "' AND origin = '" + checkObject.origin + "'";
		cassandra.execute(dropCheck)
		    .then((resp) => { resolve({}); })
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
