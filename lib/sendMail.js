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

module.exports = (recipient, template, substitutions) => {
	return new Promise((resolve, reject) => {
		substitutions.urlPrefix = urlPrefix;
		let bufHTML = fs.readFileSync('./templates/' + template + '-html.email').toString();
		let bufTXT = fs.readFileSync('./templates/' + template + '-txt.email').toString();
		let mailOptions = {
			from: process.env.MAIL_FROM || 'root@localhost',
			html: Mustache.render(bufHTML, substitutions),
			replyTo: process.env.MAIL_REPLYTO || 'replyto@localhost',
			subject: 'Please confirm your HighWayToHell account',
			text: Mustache.render(bufTXT, substitutions),
			to: recipient
		    };
		if (template === 'registration') {
		    mailOptions.subject = 'Please confirm your HighWayToHell account';
		} else if (template === 'acknotify') {
		    mailOptions.subject = 'Configuring HighWayToHell notification';
		} else if (template === 'notify') {
		    mailOptions.subject = substitutions.target + ' status changed to ' + substitutions.state;
		} else if (template === 'login') {
		    mailOptions.subject = 'HighWayToHell Login ' + substitutions.action;
		} else {
		    mailOptions.subject = 'HighWayToHell';
		}
		transport.sendMail(mailOptions, (e, r) => {
			if (e) { reject('failed sending ' + template + ' email'); }
			else { resolve(true); }
		    });
	    });
    };
