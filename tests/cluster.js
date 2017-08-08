const Promise = require('bluebird');
const exec = require('child_process').exec;
const execAsync = Promise.promisify(exec);
const test = require('../lib/advertiseNeighbors.js')('healthcheck');

execAsync('sleep 3')
    .then(() => {
	    console.log('should be initialized');
	    console.log('raw list:');
	    console.log(test.getNeighbors());
	    console.log('sorted list:');
	    console.log(test.getOrderedNeighbors());
	    console.log('id: ' + test.getId());
	    console.log('isMaster: ' + test.isElectedMaster());
	    return execAsync('sleep 5');
	})
    .then(() => {
	    console.log('raw list:');
	    console.log(test.getNeighbors());
	    console.log('sorted list:');
	    console.log(test.getOrderedNeighbors());
	    console.log('id: ' + test.getId());
	    console.log('isMaster: ' + test.isElectedMaster());
	    return execAsync('sleep 5');
	})
    .then(() => {
	    console.log('raw list:');
	    console.log(test.getNeighbors());
	    console.log('sorted list:');
	    console.log(test.getOrderedNeighbors());
	    console.log('id: ' + test.getId());
	    console.log('isMaster: ' + test.isElectedMaster());
	    return execAsync('sleep 5');
	})
    .then(() => {
	    console.log('raw list:');
	    console.log(test.getNeighbors());
	    console.log('sorted list:');
	    console.log(test.getOrderedNeighbors());
	    console.log('id: ' + test.getId());
	    console.log('isMaster: ' + test.isElectedMaster());
	    return execAsync('sleep 5');
	})
    .then(() => {
	    console.log('raw list: ' + test.getNeighbors());
	    console.log('sorted list: ' + test.getOrderedNeighbors());
	    console.log('id: ' + test.getId());
	    console.log('isMaster: ' + test.isElectedMaster());
	    process.exit(0);
	})
