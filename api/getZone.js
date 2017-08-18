const Promise = require('bluebird');

module.exports = (cassandra, domain) => {
	return new Promise ((resolve, reject) => {
		let queryDomain = "SELECT * FROM zones WHERE origin = '" + domain + "'";
		cassandra.execute(queryDomain)
		    .then((resp) => {
			    if (resp.rows !== undefined && resp.rows[0] !== undefined) {
				let queryPools = "SELECT fqdn FROM nspools WHERE tag IN ('" + resp.rows[0].nspool + "', '" + resp.rows[0].bkppool + "')";
				cassandra.execute(queryPools)
				    .then((pools) => {
					    if (pools.rows !== undefined && pools.rows[0] !== undefined) {
						resp.rows[0].nspool = pools.rows[0].fqdn;
						resp.rows[0].bkppool = (pools.rows[1] !== undefined && pools.rows[1].fqdn !== undefined) ? pools.rows[1].fqdn : pools.rows[0].fqdn;
					    }
					    resolve(resp.rows[0]);
					})
				    .catch((e) => { reject('failed resolving nspools'); });
			    } else { resolve({}); }
			})
		    .catch((e) => { reject('failed querying cassandra'); });
	    });
    };
