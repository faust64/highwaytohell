const Queue = require('bull');
const apiRouter = require('../lib/apiRouter.js');
const bodyParser = require('body-parser');
const cassandra = require('cassandra-driver');
const express = require('express');
const http = require('http');
const logger = require('../lib/logger.js')('api-gateway');
const session = require('express-session');

const app = express();
const client = new cassandra.Client({ contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']), keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth' });
const listPools = "SELECT * FROM nspools";
const redisStore = require('connect-redis')(session);

app.use(session({
	//cookie: { secure: (process.env.NODE_ENV === 'production' || process.env.HWTH_PROTO === 'https') },
	resave: false,
	saveUninitialized: false,
	secret: process.env.API_SESSION_SECRET || 'hwthapigw',
	store: new redisStore({
		host: process.env.REDIS_HOST || '127.0.0.1',
		port: process.env.REDIS_PORT || 6379,
		db: process.env.REDIS_DBID || 0,
		prefix: 'hwthsess:',
		ttl: process.env.API_SESSION_TTL || 10800,
		logErrors: logger.error
	    })
    }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); /* mandatory to post params, apparently */
if (process.env.NODE_ENV !== 'production') {
    try {
	const compression = require('compression');
	app.use(compression());
    } catch(e) {
	logger.info('could not enable compression, despite environ not being set to production');
    }
}
app.set('trust proxy', 1);

client.execute(listPools)
    .then((resp) => {
	    if (resp.rows !== undefined || resp.rows[0] !== undefined) {
		const listenAddr = process.env.APIGW_ADDR || '127.0.0.1';
		const listenPort = process.env.APIGW_PORT || 8080;
		const httpServer = http.createServer(app);
		let confQueues = {};
		let zonesQueues = {};
		for (let k = 0; k < resp.rows.length; k++) {
		    let tagName = resp.rows[k].tag;
		    confQueues[tagName] = new Queue('config refresh ' + tagName,
			    { removeOnComplete: true, redis: { port: process.env.REDIS_PORT || 6379, host: process.env.REDIS_HOST || '127.0.0.1' }});
		    zonesQueues[tagName] = new Queue('zones refresh ' + tagName,
			    { removeOnComplete: true, redis: { port: process.env.REDIS_PORT || 6379, host: process.env.REDIS_HOST || '127.0.0.1' }});
		}
		apiRouter(app, client, confQueues, zonesQueues);
		httpServer.listen(listenPort, listenAddr, (err, res) => {
			if (err) {
			    logger.error('failed starting http server');
			    process.exit(1);
			}
			logger.info('listening on ' + listenAddr + ':' + listenPort);
			if (process.env.AIRBRAKE_ID !== undefined && process.env.AIRBRAKE_KEY !== undefined) {
			    try {
				let airbrake = require('airbrake').createClient(process.env.AIRBRAKE_ID, process.env.AIRBRAKE_KEY);
				airbrake.handleExceptions();
			    } catch(e) {
				logger.info('WARNING: failed initializing airbrake');
			    }
			}
		    });
	    } else { logger.error('no nspool defined'); process.exit(1); }
	})
    .catch((e) => {
	    logger.error('failed querying cassandra initializing notification queues');
	    logger.error(e);
	    process.exit(1);
	});
