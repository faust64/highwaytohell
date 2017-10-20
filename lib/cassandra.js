const drv = require('cassandra-driver');
const readPolicy = process.env.CASSANDRA_READ_CONSISTENCY || 'one';
const writePolicy = process.env.CASSANDRA_READ_CONSISTENCY || 'one';

function resolveConsistency(str) {
    if (str === 'any' || str === 'ANY') {
	return drv.types.consistencies.any;
    } else if (str === 'one' || str === 'ONE') {
	return drv.types.consistencies.one;
    } else if (str === 'two' || str === 'TWO') {
	return drv.types.consistencies.two;
    } else if (str === 'three' || str === 'THREE') {
	return drv.types.consistencies.three;
    } else if (str === 'quorum' || str === 'QUORUM') {
	return drv.types.consistencies.quorum;
    } else if (str === 'all' || str === 'ALL') {
	return drv.types.consistencies.all;
    } else if (str === 'localQuorum' || str === 'LOCAL_QUORUM') {
	return drv.types.consistencies.localQuorum;
    } else if (str === 'eachQuorum' || str === 'EACHL_QUORUM') {
	return drv.types.consistencies.eachQuorum;
    } else if (str === 'serial' || str === 'SERIAL') {
	return drv.types.consistencies.serial;
    } else if (str === 'localSerial' || str === 'LOCAL_SERIAL') {
	return drv.types.consistencies.localSerial;
    } else if (str === 'localOne' || str === 'LOCAL_ONE') {
	return drv.types.consistencies.localOne;
    } else {
	return drv.types.consistencies.one;
    }
}

module.exports = {
	readConsistency: function(str) {
	    const policy = resolveConsistency(readPolicy);
	    return { consistency: policy };
	},

	 writeConsistency: function(str) {
	    const policy = resolveConsistency(writePolicy);
	    return { consistency: policy };
	}
    };
