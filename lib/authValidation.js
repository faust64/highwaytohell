const Joi = require('joi');
const Promise = require('bluebird');

const getIPmask = (maskSize) => { return -1<<(32-maskSize) }
const getIPnumber = (IPaddress) => {
	var ip = IPaddress.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (ip) { return (+ip[1]<<24) + (+ip[2]<<16) + (+ip[3]<<8) + (+ip[4]); }
	return null;
    };
const validationSchema = Joi.object().keys({
	userId: Joi.string(),
	accessToken: Joi.string().regex(/^[0-9a-zA-Z]*$/)
    });

module.exports = (cassandra, request, op) => {
	return new Promise ((resolve, reject) => {
		let userId = request.body.userid || false,
		    tokenString = request.body.token || false,
		    domainName = request.params.domainName || false,
		    check = { userId: userId, accessToken: tokenString };

		Joi.validate(check, validationSchema, ((err, res) => {
			if (err) {
			    if (request.session.userid !== undefined) { resolve(request.session.userid); }
			    else { reject('failed authenticating user'); }
			} else {
			    let lookupToken = "SELECT * FROM tokens WHERE idowner = '" + userId + "' AND tokenstring = '" + tokenString + "'";
			    cassandra.execute(lookupToken)
				.then((resp) => {
					if (resp.rows !== undefined && resp.rows[0] !== undefined) {
					    if (resp.rows[0].tokenstring === tokenString) {
						let validAccess = true;
						if (resp.rows[0].trusted !== undefined && resp.rows[0].trusted !== null) {
						    validAccess = false;
						    let clientIP = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
						    let trustedArray = resp.rows[0].trusted.split(',');
						    for (let k = 0; k < trustedArray.length && validAccess === false; k++) {
							if (trustedArray[k] === '*') { validAccess = true; }
							else if (trustedArray[k] === clientIP) { validAccess = true; }
							else if (trustedArray[k].indexOf('/') > 2) {
							    let check = trustedArray[k].split('/');
							    let checkNet = check[0], checkMask = check[1];
							    if ((getIPnumber(clientIP) & getIPmask(checkMask)) === getIPnumber(checkNet)) {
								validAccess = true;
							    }
							}
						    }
						}
						/*
						 * FIXME/TODO:
						 * check resp.rows[0].permissions against an action operand (op)
						 *    (+ define semantics populating that field)
						 * TO MOVE, to some resourceValidation magic ...
						 */
						if (validAccess) {
						    if (domainName) {
							let lookupDomain = "SELECT * FROM zones WHERE origin = '" + domainName + "' AND idowner = '" + resp.rows[0].idowner + "'";
							cassandra.execute(lookupDomain)
							    .then((checkdomain) => {
								    if (checkdomain.rows !== undefined && checkdomain.rows[0] !== undefined && checkdomain.rows[0].origin == domainName) {
									resolve(resp.rows[0].idowner);
								    } else if (request.url !== ('/domains/' + domainName + '/add')) { reject('access to ' + domainName + ' denied'); }
								    else { resolve(resp.rows[0].idowner); }
								})
							    .catch((e) => { reject('access to ' + domainName + ' temporarily denied'); });
						    } else { resolve(resp.rows[0].idowner); }
						} else { reject('source is not trusted'); }
					    } else { reject('failed matching'); }
					} else { reject('token not found'); }
				    })
				.catch((e) => { reject('cassandra error'); });
			}
		    }));
	    });
    };
