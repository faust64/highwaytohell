const Mustache = require('mustache');
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
const srvName = process.env.HWTH_HOSTNAME || 'localhost';
const srvPort = process.env.HWTH_PORT ? (':' + process.env.HWTH_PORT) : ((process.env.NODE_ENV === 'production' || process.env.HWTH_PROTO === 'https') ? '' : (':' + (process.env.APIGW_PORT || '8080')));
const srvProto = process.env.HWTH_PROTO || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
const transport = nodeMailer.createTransport(smtpTransport(mailConf));
const urlPrefix = srvProto + '://' + srvName + srvPort;

class SendMail {
    constructor(recipient, template, substitutions) {
	    return new Promise((resolve, reject) => {
		    substitutions.urlPrefix = urlPrefix;
		    this._bufHTML = fs.readFileSync('./templates/' + template + '-html.email').toString();
		    this._bufTXT = fs.readFileSync('./templates/' + template + '-txt.email').toString();
		    this._mailOptions = {
			    from: process.env.MAIL_FROM || 'root@localhost',
			    html: Mustache.render(this._bufHTML, substitutions),
			    replyTo: process.env.MAIL_REPLYTO || 'replyto@localhost',
			    subject: 'Please confirm your HighWayToHell account',
			    text: Mustache.render(this._bufTXT, substitutions),
			    to: recipient
			};
		    if (template === 'registration') {
			this._mailOptions.subject = 'Please confirm your HighWayToHell account';
		    } else if (template === 'acknotify') {
			this._mailOptions.subject = 'Configuring HighWayToHell notification';
		    } else if (template === 'notify') {
			this._mailOptions.subject = substitutions.target + ' status changed to ' + substitutions.state;
		    } else {
			this._mailOptions.subject = 'HighWayToHell';
		    }
		    transport.sendMail(this._mailOptions, (e, r) => {
			    if (e) { reject('failed sending ' + template + ' email'); }
			    else { resolve(true); }
			});
		});
	}
}

exports.SendMail = SendMail;
