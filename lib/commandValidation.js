const Joi = require('joi');
const Promise = require('bluebird');
const logger = require('./logger.js')('command-validation');

const is2FACode = Joi.string().regex(/^[0-9]+$/);
const is2FAConfirmation = Joi.string().regex(/^[0-9a-f]+$/);
const isActionHelper = Joi.string().regex(/^(add|edit)$/);
const isBool = Joi.boolean();
const isCassandraUUID = Joi.string().regex(/^[a-f0-9-]+$/);
const isCheckId = Joi.alternatives().try(Joi.string().regex(/^static$/), isCassandraUUID);
const isCheckName = Joi.string().regex(/^[a-zA-Z0-9 _-]*$/);
const isCheckTypeICMP = Joi.string().regex(/^icmp$/);
const isCheckTypeHTTP = Joi.string().regex(/^http$/);
const isDomain = Joi.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/);
const isEmail = Joi.string().email();
const isHeaders = Joi.string().regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$)/);
const isIPv4 = Joi.string().ip({ version: [ 'ipv4' ], cidr: 'forbidden' });
const isIPv6 = Joi.string().ip({ version: [ 'ipv6' ], cidr: 'forbidden' });
const isMagic = Joi.string().regex(/^mintberrycrunch$/);
const isName = Joi.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9])*$/);
const isNotifyDelay = Joi.number().integer().min(0).max(360);
const isNotifyContacts = Joi.string().regex(/^contacts$/);
const isNotifyHTTP = Joi.any().valid('http-post', 'http-get');
const isNotifyMail = Joi.string().regex(/^smtp$/);
const isNotifySMS = Joi.string().regex(/^sms$/);
const isPassword = Joi.string().min(6);
const isPhoneNumberString = Joi.string().min(9).regex(/^(?:\+)[0-9]*$/);
const isPhoneNumberNumeric = Joi.number().integer().min(100000000);
const isPriority = Joi.number().integer().min(0).max(100);
const isRole = Joi.any().valid('admin', 'manager', 'operator', 'viewer');
const isRoot = Joi.string().regex(/^@$/);
const isSetID = Joi.string().regex(/^[a-zA-Z0-9-_]+$/);
const isString = Joi.string();
const isThreshold = Joi.number().integer().min(2).max(10);
const isToken = Joi.string().regex(/^[a-zA-Z0-9-_=]+$/);
const isTtl = Joi.number().integer().min(60).max(604800);
const isType = Joi.any().valid('A', 'CNAME', 'TXT', 'MX', 'SOA', 'PTR', 'NS', 'AAAA');
const isURL = new RegExp("^" +
	    "(?:(?:https?|ftp)://)" +
	    "(?:\\S+(?::\\S*)?@)?" +
	    "(?:" +
		"(?!(?:10|127)(?:\\.\\d{1,3}){3})" +
		"(?!(?:169\\.254|192\\.168)(?:\\.\\d{1,3}){2})" +
		"(?!172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})" +
		"(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])" +
		"(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}" +
		"(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))" +
	    "|" +
		"(?:(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)" +
		"(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*" +
		"(?:\\.(?:[a-z\\u00a1-\\uffff]{2,}))" +
	    ")" +
	    "(?::\\d{2,5})?" +
	    "(?:/\\S*)?" +
	"$", "i"
    );
const isUnset = Joi.string().allow('');
const isUsername = Joi.string().regex(/^[a-zA-Z0-9-_]+$/);
const isCheckTarget = Joi.alternatives().try(isIPv4, isURL);
const isPhoneNumber = Joi.alternatives().try(isPhoneNumberString, isPhoneNumberNumeric);
const isRecName = Joi.alternatives().try(isName, isRoot);
const typeNeedsIPv4 = Joi.any().valid('A');
const typeNeedsIPv6 = Joi.any().valid('AAAA');
const typeNeedsName = Joi.any().valid('CNAME', 'PTR', 'NS', 'MX');
const typeNeedsString = Joi.any().valid('TXT', 'SOA');

const validRequests = {
	'2fa-confirm': { makeitpersistent: isMagic, confirmation: is2FACode },
	'2fa-disable': { confirmation: is2FAConfirmation },
	'2fa-drop-backup': { confirmation: is2FACode },
	'2fa-enable': { },
	'2fa-gen-backup': { confirmation: is2FACode },
	'2fa-login': { userid: isCassandraUUID, confirmation: is2FAConfirmation, token: isString },
	'add-authorization': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, thirdParty: isCassandraUUID, token: isToken, assumesRole: isRole, domainName: isDomain }),
					    Joi.object({ userid: isCassandraUUID, thirdParty: isEmail, token: isToken, assumesRole: isRole, domainName: isDomain }),
					    Joi.object({ thirdParty: isCassandraUUID, assumesRole: isRole, domainName: isDomain }),
					    Joi.object({ thirdParty: isEmail, assumesRole: isRole, domainName: isDomain })),
	'add-contact': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, contactType: isNotifyMail, contactTarget: isEmail }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, contactType: isNotifySMS, contactTarget: isPhoneNumber }),
					    Joi.object({ contactType: isNotifyMail, contactTarget: isEmail }),
					    Joi.object({ contactType: isNotifySMS, contactTarget: isPhoneNumber })),
	'add-healthcheck': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkId: isUnset, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkId: isUnset, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkId: isUnset, checkInvert: isBool, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkId: isUnset, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget, checkName: isCheckName })),
	'add-notification': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkId: isCassandraUUID, notifyType: isNotifyHTTP, notifyTarget: isURL, notifyUp: isNotifyDelay, notifyDown: isNotifyDelay }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkId: isCassandraUUID, notifyType: isNotifyContacts, notifyTarget: isEmail, notifyUp: isNotifyDelay, notifyDown: isNotifyDelay }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkId: isCassandraUUID, notifyType: isNotifyContacts, notifyTarget: isPhoneNumber, notifyUp: isNotifyDelay, notifyDown: isNotifyDelay }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, checkId: isCassandraUUID, notifyType: isNotifyHTTP, notifyTarget: isURL, notifyUp: isNotifyDelay, notifyDown: isNotifyDelay }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, checkId: isCassandraUUID, notifyType: isNotifyContacts, notifyTarget: isEmail, notifyUp: isNotifyDelay, notifyDown: isNotifyDelay }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, checkId: isCassandraUUID, notifyType: isNotifyContacts, notifyTarget: isPhoneNumber, notifyUp: isNotifyDelay, notifyDown: isNotifyDelay })),
	'add-record': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isIPv4, recordType: typeNeedsIPv4, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isIPv6, recordType: typeNeedsIPv6, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isName, recordType: typeNeedsName, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isString, recordType: typeNeedsString, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isIPv4, recordType: typeNeedsIPv4, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isIPv6, recordType: typeNeedsIPv6, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isName, recordType: typeNeedsName, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isString, recordType: typeNeedsString, recordTtl: isTtl, recordCheckId: isCheckId }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isIPv4, recordType: typeNeedsIPv4, recordTtl: isTtl }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isIPv6, recordType: typeNeedsIPv6, recordTtl: isTtl }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isName, recordType: typeNeedsName, recordTtl: isTtl }),
					    Joi.object({ domainName: isDomain, dowhat: isActionHelper, recordName: isRecName, recordPriority: isPriority, setId: isSetID, recordTarget: isString, recordType: typeNeedsString, recordTtl: isTtl })),
	'add-token': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, tokenPerms: isString, tokenSourceFlt: isString }),
					    Joi.object({ tokenId: isUnset, tokenPerms: isString, tokenSourceFlt: isString })),
	'adddel-domain': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain }),
					    Joi.object({ domainName: isDomain })),
	'adm-domain-get': { domainName: isDomain },
	'adm-domain-post': { userid: isCassandraUUID, token: isToken, domainName: isDomain },
	'confirm-address-get': { userId: isCassandraUUID, token: isToken },
	'confirm-address-post': Joi.alternatives().try(Joi.object({ confirmCode: isToken }),
					    Joi.object({ confirmCode: is2FACode })),
	'del-authorization': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, thirdParty: isCassandraUUID, token: isToken, domainName: isDomain }),
					    Joi.object({ userid: isCassandraUUID, thirdParty: isEmail, token: isToken, domainName: isDomain }),
					    Joi.object({ thirdParty: isCassandraUUID, domainName: isDomain }),
					    Joi.object({ thirdParty: isEmail, domainName: isDomain })),
	'del-contact': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, contactTarget: isEmail }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, contactTarget: isPhoneNumber }),
					    Joi.object({ contactTarget: isEmail }),
					    Joi.object({ contactTarget: isPhoneNumber })),
	'del-healthcheck': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkId: isCassandraUUID }),
					    Joi.object({ domainName: isDomain, checkId: isCassandraUUID })),
	'del-notification': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkId: isCassandraUUID }),
					    Joi.object({ domainName: isDomain, checkId: isCassandraUUID })),
	'del-record': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, recordName: isRecName, setId: isSetID, recordType: isType }),
					    Joi.object({ domainName: isDomain, recordName: isRecName, setId: isSetID, recordType: isType })),
	'del-token': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, tokenString: isToken }),
					    Joi.object({ tokenString: isToken })),
	'edit-healthcheck': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget, checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkType: isCheckTypeHTTP, checkHeaders: isHeaders, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isString, checkTarget: isCheckTarget, checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget , checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkInvert: isBool, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget, checkId: isCassandraUUID, checkName: isCheckName }),
					    Joi.object({ domainName: isDomain, checkType: isCheckTypeICMP, checkHeaders: isUnset, checkHealthy: isThreshold, checkUnhealthy: isThreshold, checkMatch: isUnset, checkTarget: isCheckTarget, checkId: isCassandraUUID, checkName: isCheckName })),
	'edit-token': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, tokenId: isToken, tokenPerms: isString, tokenSourceFlt: isString }),
					    Joi.object({ tokenId: isToken, tokenPerms: isString, tokenSourceFlt: isString })),
	'get-domain': { userid: isCassandraUUID, token: isToken, domainName: isDomain },
	'get-healthcheck-get': { domainName: isDomain, checkId: isCassandraUUID },
	'get-healthcheck-post': { userid: isCassandraUUID, token: isToken, domainName: isDomain, checkId: isCassandraUUID },
	'get-healthchecks-get': { domainName: isDomain },
	'get-healthchecks-post': { userid: isCassandraUUID, token: isToken, domainName: isDomain },
	'get-notification-get': { domainName: isDomain, checkId: isCassandraUUID },
	'get-notification-post': { userid: isCassandraUUID, token: isToken, domainName: isDomain, checkId: isCassandraUUID },
	'get-notifications-get': { domainName: isDomain },
	'get-notifications-post': { userid: isCassandraUUID, token: isToken, domainName: isDomain },
	'get-record-get': { domainName: isDomain, recordName: isRecName },
	'get-record-post': { userid: isCassandraUUID, token: isToken, domainName: isDomain, recordName: isRecName },
	'get-records-get': { domainName: isDomain },
	'get-records-post': { userid: isCassandraUUID, token: isToken, domainName: isDomain },
	'get-tokens-get': { },
	'get-tokens-post': { userid: isCassandraUUID, token: isToken },
	'list-contacts-get': { },
	'list-contacts-post': { userid: isCassandraUUID, token: isToken },
	'list-domains-get': { },
	'list-domains-post': { userid: isCassandraUUID, token: isToken },
	'login': { emailaddress: isEmail, userpw: isPassword },
	'login-notifications': Joi.alternatives().try(Joi.object({ logFailure: isBool }),
					    Joi.object({ logSuccess: isBool })),
	'logs': { userid: isCassandraUUID, token: isToken },
	'register': { username: isUsername, password: isPassword, passwordConfirm: isPassword, emailaddr: isEmail },
	'settings-get': { },
	'settings-post': Joi.alternatives().try(Joi.object({ userid: isCassandraUUID, token: isToken, password: isPassword, passwordConfirm: isPassword }),
					    Joi.object({ userid: isCassandraUUID, token: isToken, email: isEmail }),
					    Joi.object({ email: isUnset, password: isPassword, passwordConfirm: isPassword }),
					    Joi.object({ email: isEmail, password: isUnset, passwordConfirm: isUnset }))
    };

module.exports = ((req, res, routeId) => {
	return new Promise((resolve, reject) => {
		let params = Object.assign(req.params, req.body);

		let schema = validRequests[routeId] || { everyoneknows: Joi.string().regex(/^itsbutters$/) };
		if (process.env.DEBUG) {
		    logger.info('validating request on ' + req.path);
		    logger.info(params);
		}

		Joi.validate(params, schema, { abortEarly: true, presence: 'required' }, (err, val) => {
			params.actualHost = req.headers.host;
			params.actualIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
			if (err) { reject(err); }
			else { resolve(params); }
		    });
	    });
    });
