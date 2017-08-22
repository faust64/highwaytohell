#!/bin/sh

ret=0
if ! ./samples.d/butters | grep peerio.com; then
    echo failed listing domains
    ret=`expr $ret + 1`
fi
#if ! ./samples.d/butters -d peerio.com -a get --getdsrecords | grep '^{}$'; then
# backends error on circleci? should divert logs to file
#    echo failed fetching ds records
#    ret=`expr $ret + 1`
#fi
if ! ./samples.d/butters -d peerio.com -a get --getdsrecords | grep '^{}$'; then
    echo failed fetching ds records
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -R notifications 2>&1 | grep 'authentication failed'; then
    echo authenticated against default domain example.com, which should not exist nor belong to test user
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R notifications | grep '^\[\]$'; then
    echo failed listing notifications
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R records | grep iceblobvirginia; then
    echo failed listing records
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R records -a add -r @ -T myrelay.mail.com -t MX --priority 10; then
    echo failed adding mx record
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R records -a get --record @ | grep myrelay; then
    echo failed fetching record by name
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R records -a del -r @; then
    echo failed dropping record
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R healthchecks | grep peerio.com; then
    echo failed listing health checks
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R healthchecks -a add -T https://www.google.com --header www.google.com --match Google --checkname GGL; then
    echo failed registering health check
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R healthchecks -a get --checkid e2f2dfb2-7928-11e7-91c1-ed90532c5f11 | grep requireunhealthy; then
    echo failed fetching health check
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R healthchecks -a del --checkid e2f2dfb2-7928-11e7-91c1-ed90532c5f11; then
    echo failed dropping health check
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R healthchecks -a get --checkid e2f2dfb2-7928-11e7-91c1-ed90532c5f11 | grep -E '^{}$'; then
    echo healthcheck table inconsistent - dropped health check still showing
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -d peerio.com -R healthhistory -a get --checkid e2f2dfb0-7928-11e7-abc0-01fda1e91471 | grep -E 'when.*[0-9]*.*value.*(true|false)'; then
    echo failed quering history
    ret=`expr $ret + 1`
fi
if ! ./samples.d/butters -R contacts | grep '"active":"confirmed"'; then
    echo failed querying contacts
    ret=`expr $ret + 1`
fi

echo ret is $ret
exit $ret
