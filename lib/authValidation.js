const Joi = require('joi');
const Promise = require('bluebird');

const getIPmask = (maskSize) => { return -1<<(32-maskSize) }
const getIPnumber = (IPaddress) => {
	var ip = IPaddress.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (ip) { return (+ip[1]<<24) + (+ip[2]<<16) + (+ip[3]<<8) + (+ip[4]); }
	return null;
    };
const tokenAuthSchema = Joi.object().keys({
	userId: Joi.string(),
	accessToken: Joi.string().regex(/^[0-9a-zA-Z]*$/)
    });

module.exports = (cassandra, request, op) => {
	return new Promise ((resolve, reject) => {
		let userId = request.body.userid || false,
		    tokenString = request.body.token || false,
		    domainName = request.params.domainName || request.body.domainName || false;

		    /*
		     * FIXME: include context permissions check in there
		     *    (+ define semantics populating that field)
		     */
		let checkPerms = function(domain, user, contextPerms) {
			return new Promise ((res, rej) => {
				let realId = request.session.userid || userId;
				let lookupPerms = "SELECT role FROM rbaclookalike WHERE domain = '" + domainName + "' AND uuid = '" + realId + "'";
				cassandra.execute(lookupPerms)
				    .then((role) => {
					    if (role.rows !== undefined && role.rows[0] !== undefined) {
						let [prefix, prem] = op.split(':');
						if (role.rows[0].role === 'admin') { res(true); }
						else if (prefix === 'settings' || prefix === 'tokens') { res(true); }
						else if (role.rows[0].role === 'manager') {
						    if (perm !== 'adm') { res(true); }
						    else { rej('manager is not admin'); }
						} else if (role.rows[0].role === 'operator') {
						    if (prefix === 'zones' && perm !== 'ro') { rej('operator is not manager'); }
						    else if (perm !== 'adm') { res(true); }
						    else { rej('operator is not admin'); }
						} else if (role.rows[0].role === 'viewer') {
						    if (perm !== 'ro') { rej('viewer is not operator'); }
						    else { res(true); }
						} else { rej('not authorized, somehow'); }
					    } else if (request.path === '/domains/' + domainName + '/add') {
						res(true);
					    } else { rej('not authorized to access ' + domainName); }
					})
				    .catch((e) => { rej('failed querying cassandra checking for authorization'); });
			    });
		    };

		Joi.validate({ userId: userId, accessToken: tokenString }, tokenAuthSchema, ((err, res) => {
			if (err) {
			    if (request.session.userid !== undefined) {
				if (domainName !== false) {
				    checkPerms(domainName, request.session.userid, '*')
					.then((res) => { resolve(request.session.userid); })
					.catch((e) => { reject(e); });
				} else { resolve(request.session.userid); }
			    } else { reject('failed authenticating user'); }
			} else {
			    let lookupToken = "SELECT * FROM tokens WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenString + "'";
			    cassandra.execute(lookupToken)
				.then((resp) => {
					if (resp.rows !== undefined && resp.rows[0] !== undefined) {
					    let validAccess = false;
					    if (resp.rows[0].trusted !== undefined && resp.rows[0].trusted !== null) {
						let clientIP = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
						let trustedArray = resp.rows[0].trusted.split(',');
						for (let k = 0; k < trustedArray.length && validAccess === false; k++) {
						    if (trustedArray[k] === '*') { validAccess = true; }
						    else if (trustedArray[k] === clientIP) { validAccess = true; }
						    else if (trustedArray[k].indexOf('/') > 2) {
							let [checkNet, checkMask] = trustedArray[k].split('/');
							if ((getIPnumber(clientIP) & getIPmask(checkMask)) === getIPnumber(checkNet)) {
							    validAccess = true;
							}
						    }
						}
					    } else { validAccess = true; }
					    if (validAccess) {
						if (domainName !== false) {
						    checkPerms(domainName, resp.rows[0].idowner, resp.rows[0].permissions)
							.then((res) => { resolve(resp.rows[0].idowner); })
							.catch((e) => { reject(e); });
						} else { resolve(resp.rows[0].idowner); }
					    } else { reject('source is not trusted'); }
					} else { reject('token not found'); }
				    })
				.catch((e) => { reject('cassandra error'); });
			}
		    }));
	    });
    };
