const Promise = require('bluebird');
const fs = require('fs');
const nodeMailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');

let mailConf = { host : process.env.SMTP_HOST || '127.0.0.1' };
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailConf.auth.user = process.env.SMTP_USER;
    mailConf.auth.pass = process.env.SMTP_PASS;
}
if (process.env.SMTP_SSL) {
    mailConf.ignoreTLS = false;
    mailConf.port = 465;
    mailConf.secure = true;
} else { mailConf.port = 25; }
const bufHTML = fs.readFileSync('./templates/registration-txt.email');
const bufTXT = fs.readFileSync('./templates/registration-html.email');
const srvName = process.env.HWTH_HOSTNAME || 'localhost';
const srvPort = process.env.HWTH_PORT ? (':' + process.env.HWTH_PORT) : ((process.env.NODE_ENV === 'production' || process.env.HWTH_PROTO === 'https') ? '' : (':' + (process.env.APIGW_PORT || '8080')));
const srvProto = process.env.HWTH_PROTO || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
const transport = nodeMailer.createTransport(smtpTransport(mailConf));

const mainPrefix = srvProto + '://' + srvName + srvPort;
const urlPrefix = mainPrefix + '/settings/confirm-address/';

class SendMail {
    constructor(username, userId, token, emailaddr) {
	    return new Promise((resolve, reject) => {
		    this._mailOptions = {
			    from: process.env.MAIL_FROM || 'root@localhost',
			    subject: 'Please confirm your HighWayToHell account',
			    replyTo: process.env.MAIL_REPLYTO || 'replyto@localhost',
			};
		    this._mailOptions.text = new String(bufTXT).replace('REWRITERCPT', username).replace('REWRITELINK', urlPrefix + userId + '/' + token);
		    this._mailOptions.html = new String(bufHTML).replace('REWRITERCPT', username).replace('REWRITELINK', urlPrefix + userId + '/' + token).replace('REWRITEASSETS', mainPrefix);;
		    this._mailOptions.to = emailaddr;
		    transport.sendMail(this._mailOptions, (e, r) => {
			    if (e) { reject('failed sending confirmation email'); }
			    else { resolve(true); }
			});
		});
	}
}

exports.SendMail = SendMail;
