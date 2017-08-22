function addAuthorization(domainName) {
    var userForm = document.getElementById('mgtuser');
    var roleForm = document.getElementById('mgtrole');
    userForm.value = '';
    roleForm.value = 'admin';
    showForm('Add Authorization');
}

function addHealthCheck(domainName) {
    var actionForm = document.getElementById('formhealthchecks');
    var headersForm = document.getElementById('checkheaders');
    var healthyForm = document.getElementById('checkhealthy');
    var idForm = document.getElementById('checkid');
    var invertForm = document.getElementById('checkinvert');
    var matchForm = document.getElementById('checkmatch');
    var nameForm = document.getElementById('checkname');
    var targetForm = document.getElementById('checktarget');
    var typeForm = document.getElementById('checktype');
    var unhealthyForm = document.getElementById('checkunhealthy');
    actionForm.action = '/healthchecks/' + domainName + '/add';
    headersForm.value = '';
    healthyForm.value = 3;
    idForm.value = '';
    invertForm.checked = false;
    matchForm.value = '';
    nameForm.value = '';
    targetForm.value = '';
    typeForm.value = 'http';
    unhealthyForm.value = 2;
    showForm('Add Health Check');
}

function addNotification(domainName) {
    var actionForm = document.getElementById('formAction');
    var downForm = document.getElementById('notifydown');
    var idForm = document.getElementById('checkid');
    var targetForm = document.getElementById('notifycontainer');
    var typeForm = document.getElementById('notifytype');
    var upForm = document.getElementById('notifyup');
    actionForm.value = 'add';
    downForm.value = 2;
    idForm.value = '';
    targetForm.innerHTML = "<input id='notifytarget' type='text' size=32 name='notifyTarget'/>";
    typeForm.value = 'http-post';
    upForm.value = 3;
    showForm('Add Notification');
}

function addRecord() {
    var actionForm = document.getElementById('formAction');
    var healthCheckForm = document.getElementById('recordhc');
    var nameForm = document.getElementById('targetSource');
    var prioForm = document.getElementById('recordprio');
    var setIdForm = document.getElementById('recordsetid');
    var targetForm = document.getElementById('recordtarget');
    var ttlForm = document.getElementById('recordttl');
    var typeForm = document.getElementById('recordtype');
    actionForm.value = 'add';
    healthCheckForm.value = 'STATIC';
    nameForm.value = '';
    prioForm.value = 0;
    setIdForm.value = '';
    targetForm.value = '';
    ttlForm.value = 3600;
    typeForm.value = 'A';
    showForm('Register Record');
}

function addToken() {
    var actionForm = document.getElementById('formtokens');
    var permsForm = document.getElementById('tokperms');
    var sourcesForm = document.getElementById('toksources');
    actionForm.action = '/settings/tokens/add';
    permsForm.value = '*';
    sourcesForm.value = '*';
    showForm('Add Token');
}

function checkRegistration() {
    var left = document.getElementById('pass1').value;
    var right = document.getElementById('pass2').value;
    if (left && right && left !== "" && right !== "") {
	if (left === right) {
	    if (left.length >= 12) { return true; }
	    else { alert('please try with a longer password (12 chars min)'); }
	} else { alert('mismatching passwords, try again'); }
    } else { alert('password can not be empty'); }
    return false;
}

function confirmContact(target) {
    var code = prompt('Type in the confirmation code you received:');
    if (code.length > 5) {
	post('/settings/confirm-address', { confirmCode: code });
    } else { alert('PIN looks too short'); }
}

function allowDrop(ev) { ev.preventDefault(); }
function drag(ev) { ev.dataTransfer.setData("text", ev.target.id); }
function drop(ev) {
    ev.preventDefault();
    var d = document.getElementById('droppable');
    d.style.position = 'absolute';
    d.style.left = ev.clientX + 'px';
    d.style.top = ev.clientY + 'px';
}

function dropAuthorization(domainName, userId) {
    var usure = confirm('Deny ' + userId + ' accesses to ' + domainName + '? This can not be un-done');
    if (usure === true) {
	post('/domains/' + domainName + '/admin/del', { thirdParty: userId });
    }
}

function dropContact(target) {
    var usure = confirm('Drop contact ' + target + '? This can not be un-done');
    if (usure === true) {
	post('/settings/contacts/del', { contactTarget: target });
    }
}

function dropDomain(domainName) {
    var usure = confirm('Drop domain ' + domainName + '? This can not be un-done');
    if (usure === true) {
	post('/domains/' + domainName + '/del', { })
    }
}

function dropHealthCheck(domainName, checkId) {
    var usure = confirm('Drop health check ' + checkId + '? This can not be un-done');
    if (usure === true) {
	post('/healthchecks/' + domainName + '/del/' + checkId, { });
    }
}

function dropNotification(domainName, checkId, type) {
    var usure = confirm('Drop ' + type + ' notification for ' + checkId + '? This can not be un-done');
    if (usure === true) {
	post('/notifications/' + domainName + '/del/' + checkId, { /* notificationType: type */ });
    }
}

function dropRecord(domainName, name, type, setId) {
    var usure = confirm('Drop record ' + name + '? This can not be un-done');
    if (usure === true) {
	post('/records/' + domainName + '/del/' + name, { setId: setId, recordType: type });
    }
}

function dropToken(tokenString) {
    var usure = confirm('Drop token? This can not be un-done');
    if (usure === true) {
	post('/settings/tokens/del', { tokenString: tokenString });
    }
}

function editAuthorization(domainName, userId, role) {
    var userForm = document.getElementById('mgtuser');
    var roleForm = document.getElementById('mgtrole');
    userForm.value = userId;
    roleForm.value = role;
    showForm('Edit Authorization');
}

function editHealthCheck(domainName, checkId, checkName, checkType, checkHeaders, checkTarget, checkMatch, checkHealthy, checkUnhealthy, checkInvert) {
    var actionForm = document.getElementById('formhealthchecks');
    var headersForm = document.getElementById('checkheaders');
    var healthyForm = document.getElementById('checkhealthy');
    var idForm = document.getElementById('checkid');
    var invertForm = document.getElementById('checkinvert');
    var matchForm = document.getElementById('checkmatch');
    var nameForm = document.getElementById('checkname');
    var targetForm = document.getElementById('checktarget');
    var typeForm = document.getElementById('checktype');
    var unhealthyForm = document.getElementById('checkunhealthy');
    actionForm.action = '/healthchecks/' + domainName + '/edit/' + checkId;
    headersForm.value = (checkHeaders !== '-' ? checkHeaders : '');
    healthyForm.value = checkHealthy;
    idForm.value = checkId;
    invertForm.checked = (checkInvert !== 'no');
    matchForm.value = (checkMatch !== '-' ? checkMatch : '');
    nameForm.value = checkName;
    targetForm.value = checkTarget;
    typeForm.value = checkType;
    unhealthyForm.value = checkUnhealthy;
    showForm('Edit Health Check');
}

function editNotification(domainName, checkId, checkType, checkTarget, checkHealthy, checkUnhealthy) {
    var actionForm = document.getElementById('formAction');
    var downForm = document.getElementById('notifydown');
    var idForm = document.getElementById('checkid');
    var targetForm = document.getElementById('notifycontainer');
    var typeForm = document.getElementById('notifytype');
    var upForm = document.getElementById('notifyup');
    actionForm.value = 'edit';
    downForm.value = checkUnhealthy;
    idForm.value = checkId;
    if (checkType === 'contacts') {
	var contactHelper = document.getElementById('contactHelper');
	var res = "<select id='notifytarget' name='notifyTarget'>";
	res += contactHelper.innerHTML;
	res += "</select>";
	targetForm.innerHTML = res;
	var notifyForm = document.getElementById('notifytarget');
	for (var i = 0; i < notifyForm.length; i++) {
	    if (notifyForm[i].value === checkTarget) {
		notifyForm[i].selected = true;
		break;
	    }
	}
    } else {
	targetForm.innerHTML = "<input id='notifytarget' type='text' size=32 name='notifyTarget' value='" + checkTarget + "'/>";
    }
    typeForm.value = checkType;
    upForm.value = checkHealthy;
    showForm('Edit Notification');
}

function editRecord(domainName, recName, recType, recPriority, recTarget, recSetId, recHealthCheck, recTtl) {
    var actionForm = document.getElementById('formAction');
    var healthCheckForm = document.getElementById('recordhc');
    var nameForm = document.getElementById('targetSource');
    var prioForm = document.getElementById('recordprio');
    var setIdForm = document.getElementById('recordsetid');
    var targetForm = document.getElementById('recordtarget');
    var ttlForm = document.getElementById('recordttl');
    var typeForm = document.getElementById('recordtype');
    actionForm.value = 'edit';
    healthCheckForm.value = (recHealthCheck !== 'none' ? recHealthCheck : 'STATIC');
    nameForm.value = recName;
    prioForm.value = recPriority;
    setIdForm.value = recSetId;
    targetForm.value = recTarget;
    ttlForm.value = recTtl;
    typeForm.value = recType;
    showForm('Update Record');
}

function editSettings() {
    var confForm = document.getElementById('passwordConfirm');
    var emailForm = document.getElementById('emailaddr');
    var passForm = document.getElementById('password');
    confForm.value = '';
    emailForm.value = '';
    passForm.value = '';
    showForm('Edit Settings');
}

function editToken(tokenId, tokenPerms, tokenSources) {
    var actionForm = document.getElementById('formtokens');
    var idForm = document.getElementById('tokenid');
    var permsForm = document.getElementById('tokperms');
    var sourceForm = document.getElementById('toksources');
    actionForm.action = '/settings/tokens/edit';
    idForm.value = tokenId;
    permsForm.value = tokenPerms;
    sourceForm.value = tokenSources;
    showForm('Edit Token');
}

function hideForm() {
    var form = document.getElementById('overlay');
    if (form) { form.style.visibility = 'hidden'; }
}

function load() {
    var form = document.getElementById('overlay');
    if (form) {
	window.onkeyup = function () { if (event.keyCode == 27) { form.style.visibility = 'hidden'; } };
    }
}

function post(path, params, method) {
    method = method || 'post';

    var my = document.createElement('form');
    my.setAttribute('method', method);
    my.setAttribute('action', path);

    for (var key in params) {
	if (params.hasOwnProperty(key)) {
	    var hiddenField = document.createElement('input');
	    hiddenField.setAttribute('type', 'hidden');
	    hiddenField.setAttribute('name', key);
	    hiddenField.setAttribute('value', params[key]);
	    my.appendChild(hiddenField);
	}
    }
    document.body.appendChild(my);
    my.submit();
}

function setNotificationTarget() {
    var selectForm = document.getElementById('notifytype');
    var targetForm = document.getElementById('notifycontainer');
    if (selectForm.value === 'contacts') {
	var contactHelper = document.getElementById('contactHelper');
	var res = "<select id='notifytarget' name='notifyTarget'>";
	res += contactHelper.innerHTML;
	res += "</select>";
	targetForm.innerHTML = res;
	var notifyForm = document.getElementById('notifytarget');
	notifyForm[0].selected = true;
    } else {
	targetForm.innerHTML = "<input id='notifytarget' type='text' size=32 name='notifyTarget'/>";
    }
}

function showForm(title) {
    var form = document.getElementById('overlay');
    if (form) { form.style.visibility = 'visible'; }
    if (title !== undefined) {
	var formTitle = document.getElementById('formname');
	if (formTitle) { formTitle.innerHTML = title; }
	var submitForm = document.getElementById('hacksubmit');
	if (submitForm) { submitForm.value = title; }
	var setSize = false;
	if (title.indexOf('Authorization') >= 0) { setSize = '150px'; }
	else if (title.indexOf('Settings') >= 0) { setSize = '200px'; }
	else if (title.indexOf('Contact') >= 0) { setSize = '130px'; }
	else if (title.indexOf('Health Check') >= 0) { setSize = '280px'; }
	else if (title.indexOf('Notification') >= 0) { setSize = '230px'; }
	else if (title.indexOf('Record') >= 0) { setSize = '240px'; }
	else if (title.indexOf('Token') >= 0) { setSize = '150px'; }
	if (setSize !== false) {
	    var nstd = document.getElementById('droppable');
	    if (nstd) { nstd.style.height = setSize; }
	}
    }
}

function updateFormAction(where) {
    var form = document.getElementById('form' + where);
    if (form) {
	if (where === 'domains') {
	    var actionUrl = document.getElementById('targetSource').value;
	    form.action = '/domains/' + actionUrl + '/add';
	} else if (where === 'records') {
	    var actionUrl = document.getElementById('targetSource').value;
	    var domainName = document.getElementById('formHelper').value;
	    var malcolm = document.getElementById('formAction').value;
	    form.action = '/records/' + domainName + '/' + malcolm + '/' + actionUrl;
	} else if (where === 'notifications') {
	    var actionUrl = document.getElementById('checkid').value;
	    var domainName = document.getElementById('formHelper').value;
	    var malcolm = document.getElementById('formAction').value;
	    form.action = '/notifications/' + domainName + '/' + malcolm + '/' + actionUrl;
	} else {
	    alert('unhandled form');
	}
    } else {
	alert('could not locate form element');
    }
}

function updateFormFields(what) {
    if (what === "changepassword") {
	var emailForm = document.getElementById('emailaddr');
	emailForm.value = '';
	var left = document.getElementById('password').value;
	var right = document.getElementById('passwordConfirm').value;
	if (left && right && left !== "" && right !== "") {
	    if (left === right) {
		if (left.length >= 12) { return true; }
		else { alert('please try with a longer password (12 chars min)'); }
	    } else { alert('mismatching passwords, try again'); }
	} else { alert('password can not be empty'); }
	return false;
    } else if (what === "changeemail") {
	var confForm = document.getElementById('passwordConfirm');
	var passForm = document.getElementById('password');
	confForm.value = '';
	passForm.value = '';
    }
}

function updateSetId() {
    var recordForm = document.getElementById('targetSource');
    var setIdForm = document.getElementById('recordsetid');
    if (recordForm && setIdForm) {
	setIdForm.value = recordForm.value;
    }
}
