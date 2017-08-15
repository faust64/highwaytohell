const Queue = require('bee-queue');
const apiRouter = require('../lib/apiRouter.js');
const bodyParser = require('body-parser');
const cassandra = require('cassandra-driver');
const express = require('express');
const http = require('http');
const logger = require('../lib/logger.js')('api-gateway');
const session = require('express-session');
const workerPool = process.env.HWTH_POOL || 'default';

const app = express();
let cassandraOpts = {
	contactPoints: (process.env.CASSANDRA_HOST ? process.env.CASSANDRA_HOST.split(' ') : ['127.0.0.1']),
	keyspace: process.env.CASSANDRA_KEYSPACE || 'hwth'
    };
if (process.env.CASSANDRA_AUTH_USER && process.env.CASSANDRA_AUTH_PASS) {
    cassandraOpts.authProvider = new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_AUTH_USER, process.env.CASSANDRA_AUTH_PASS);
}
const client = new cassandra.Client(cassandraOpts);
const listPools = "SELECT * FROM nspools";
const redisBackend = process.env['REDIS_HOST_' + workerPool] || process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env['REDIS_PORT_' + workerPool] || process.env.REDIS_PORT || 6379;
const redisStore = require('connect-redis')(session);

const notifyQueue = new Queue('outbound-notify-' + workerPool, { removeOnSuccess: true, isWorker: false, redis: { port: redisPort, host: redisBackend }});

app.use(session({
	//cookie: { secure: (process.env.NODE_ENV === 'production' || process.env.HWTH_PROTO === 'https') },
	resave: false,
	saveUninitialized: false,
	secret: process.env.API_SESSION_SECRET || 'hwthapigw',
	store: new redisStore({
		host: redisBackend,
		port: redisPort,
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
		    let queueBackend = process.env['REDIS_HOST_' + tagName] || process.env.REDIS_HOST || '127.0.0.1';
		    let queuePort = process.env['REDIS_PORT_' + tagName] || process.env.REDIS_PORT || 6379;
		    confQueues[tagName] = new Queue('config-refresh-' + tagName, { removeOnSuccess: true, isWorker: true, redis: { port: queuePort, host: queueBackend }});
		    zonesQueues[tagName] = new Queue('zones-refresh-' + tagName, { removeOnSuccess: true, isWorker: true, redis: { port: queuePort, host: queueBackend }});
		}
		apiRouter(app, client, confQueues, zonesQueues, notifyQueue);
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
