const Promise = require('bluebird');
const drv = require('cassandra-driver');

module.exports = (cassandra, userId) => {
	return new Promise ((resolve, reject) => {
		let getTokens = "SELECT * FROM tokens WHERE idowner = '" + userId + "'";
		cassandra.execute(getTokens, [], { consistency: drv.types.consistencies.one })
		    .then((resp) => {
			    if (resp.rows !== undefined) { resolve(resp.rows); }
			    else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
