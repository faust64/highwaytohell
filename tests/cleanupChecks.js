const cassandra = require('cassandra-driver');
const checkHealth = require('../lib/checkHealth.js');
const schedule = require('node-schedule');

const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });
const checksLookup = 'SELECT * FROM checks';
const lastCheckedLookup = 'SELECT when FROM checkhistory WHERE id = ? ORDER BY when asc LIMIT 1';

const cleanup = schedule.scheduleJob('*/10 * * * * *', () => {
	let evictBefore = (Date.now() - 3600000);
	client.execute(checksLookup)
	    .then(result => {
		    if (result.rows !== undefined) {
			result.rows.forEach(check => {
				let lookup = 'SELECT when FROM checkhistory WHERE id = ' + check.id + ' ORDER BY when asc';
				client.execute(lookup)
				    .then(history => {
					    if (history.rows !== undefined) {
						let commands = [];
						history.rows.forEach(row => {
							console.log('comparing ' + row.when + ' to ' + evictBefore);
							if (parseInt(row.when) < evictBefore) {
							    commands.push({ query: "DELETE FROM checkhistory WHERE id = " + check.id + " AND when = '" + row.when + "'" });
							}
						    });
						if (commands.length > 0) {
						    client.batch(commands, function(err) {
							    if (err) {
								console.log('failed purging older records for check ' + check.id);
							    } else {
								console.log('purged older records for check ' + check.id);
							    }
							});
						}
					    }
					});
			    });
		    }
		});
    });
