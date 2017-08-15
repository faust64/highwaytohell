# HighWayToHell

Table of Contents
=================

  * [HighWayToHell](#high-way-to-hell)
    * [Introducing HWTH](#introducing-hwth)
      * [What does it do](#what-does-it-do)
      * [Todolist](#todolist)
      * [QuickStart](#quickstart)
    * [Databases](#databases)
    * [Workers](#workers)
      * [refreshZones](#refreshzones)
      * [checkHealth](#checkhealth)
      * [outboundNotifier](#outboundnotifier)
      * [apiGW](#apigw)
    * [CLI](#cli)
    * [Special Thanks](#special-thanks)

## Introducing HWTH

![HWTH Pool Illustrated](samples.d/diags/hwth.png)

![Scaling out HWTH](samples.d/diags/hwth-distribution.png)

Some hopefully-scalable, DNSSEC-capable, DNS manager featuring health checks
& alerts configuration (HTTP POST/GET, SMS or email).
Let's be honest, the point is to replace Route53 where I can, if I can, ...
Any advices, contribution or feedback welcome.

### What does it do

 * debian packages can be generated via Makefile. Installing package, no
   service would be started. Upgrading packages, services would be reloaded.
 * having a running Cassandra & Redis setup, and installed service profile
   configuration (`/var/lib/highwaytohell/.profile`, see setup instructions),
   you may start several workers, depending on the features you want to run
 * starting the refreshZones worker, you would be able to generate NSD or
   BIND configurations & corresponding zones files. Note before doing so,
   you would have to start a `hwth-watchmark` service in charge of reloading
   your nameserver configuration - as root, while NodeJS user can't.
 * starting the checkHealth worker, you would be able to run health checks
   that may eventually be used as conditions generating your DNS zones or
   scheduling notifications
 * starting the apiGW worker - and configuring some SSL-capable reverse
   proxy forwarding connections to your lookpack on port 8080, you would
   have access to a web client declaring domains, records, health checks,
   creating API tokens for CLI usage (see `samples.d/butters`), enabling
   2FA protection via authenticator such as Authy.
 * starting the outboundNotifier worker, you should be able to configure
   POST/GET/email/SMS notifications based on your health check statuses,
   as well as notifications on login and/or failed login accessing our
   web service

### Todolist

 * sharing zones management with third-party accounts (management entities)
 * proper ACL management restricting accesses within a zone (RO mode)
 * notifier (mail/hook/sms?) - outboundNotifier work in progress
 * for all queries, refactor the way we ensure user is allowed to proceed
 * handling redis authentication
 * paging (?)
 * zones import tool?
 * unclear yet how we'll trust phone numbers as contacts ...
 * add a name column to our healthchecks table? for clarity - so far identifying
   them with the target being evaluated
 * moar tests
 * api-less mode?
 * shinyness - CSS or frontend contributions most welcome
 * packaging: DB update & schema versioning (based on debvers?)
 * DNSSEC keys rotation open to discussion, bearing in mind it implies
   publishing new DS records to registrar, we can't automate it unilaterally
 * reproducible benchmarks & gnuplot magic ...

### QuickStart

```
$ mkdir build-dir
$ cd build-dir
$ sudo su
# apt-get update ; apt-get install debhelper rsync make
# exit
$ git clone https://github.com/faust64/highwaytohell.git
$ cd highwaytohell
$ make createinitialarchive
$ make createdebbin
$ ls ../
highwaytohell  highwaytohell_0.0.1-alpha1_all.deb  highwaytohell_0.0.1-alpha1_amd64.changes  highwaytohell_0.0.1-alpha1.debian.tar.gz  highwaytohell_0.0.1-alpha1.dsc  highwaytohell_0.0.1.orig.tar.gz
```

Later on, you may install this package alongside nsd:

```
# apt-get update ; apt-get install rsync gcc g++ ldnsutils nsd
# dpkg -i highwaytohell*deb
```

Or bind (untested yet, should be capable of generating zones configurations):

```
# apt-get update ; apt-get install rsync gcc g++ dnsutils bind
# dpkg -i highwaytohell*deb
```

Note that scaling out, only our `refreshZones` workers would require these DNS
utils to be installed.

Before starting services, keep in mind to create your Cassandra keyspace and
corresponding tables, using `db/cassandra.init` (having installed our debian
package: `/usr/share/doc/highwaytohell/cassandra.init`), bearing in mind the
keyspace replication strategy depends on your Cassandra cluster configuration.

Give a look to `/var/lib/highwaytohell/.profile-sample`. Install your own
copy as `/var/lib/highwaytohell/.profile` updating variables according to
your own setup (do not forget setting the ones related to email relaying,
as you would not be able to register an account without clicking some
confirmation link). Make sure the profile you installed can be read by
`hwth` (`chmod 0644` should do, preferably `root` owned).

Having started service, the apiGW worker should be listening on your loopback,
port 8080. Setup some reverse proxy (see `samples.d/nginx.conf`). Access
your virtualhost root to create your initial account and log in.

## Databases

Using a Redis backend - as a jobs queue, pub/sub, sessions storage,
2FA-establishing-token & 2FA-validated-token storage

Using a Cassandra backend storing pretty much everything else. The followings
tables would be used:

 * users: account-specific settings
 * twofa: a collection of 2fa secrets and mapped to their owner
 * tokens: a collection of tokens, mapped to their owner. TODO: a permissions
   string is defined, yet not used
 * contactaddresses: collection of contact addresses (only emails so far,
   could eventually include phone numbers) mapped to their owner
 * logins: a login history collection, associating an user ID to a client IP,
   a timestamp and wether login succeeded or failed
 * nspools: inventory of ns pools
 * zones: zones inventory and global settings, mapped to their owner and nspool
 * records: DNS records definitions, mapped to their zone
 * checks: health checks definitions, mapped to their zone
 * checkhistory: health checks history, mapped to a check
 * notifications: a collection of conditions and target to notify, when service
   health changes, mapped to a check
 * dnsseckeys: storing base64-encoded ZSK & KSK keys, mapped to a ZSK & KSK
   key names, as listed in the zones table
 * signedzones: storing base64-encoded DNSSEC zones, once they're signed, for
   our neighbors to get their copy. mapped to a domain (FIXME: map to owner)

## Workers

### refreshZones

A first class of worker is in charge of generating zones. `refreshZones`
connects to a couple of bull queue, and also opens a pair of
publisher/subscriber to redis.
Workers from a pool receive refresh notifications (from our API gw or
health check workers) via the bull queues.
Upon completion, we send the corresponding domain name into our pubsub, so
that our neighbors eventually reload their own zones as well.

If a zone is subject to DNSSEC, then a signed copy is uploaded to Cassandra
when zone gets updated - and that copy gets installed to neighbors.

NOTE: the `refreshZones` worker, running from an unprivileged user, would
not be able to reload your name servers. To address this, there is a second
service you would need to enable on any `refreshZones` also serving DNS
zones to the public. Said process would run as root, using `inotifywait`
to reload `nsd` or `bind`, whenever a mark file gets updated in the process
of refreshing zones.

Assuming that either bind or nsd package was present while installing
highwaytohell package, then either `/etc/systemd/system/hwth-watchmark.service`
or `/etc/init.d/hwth-watchmark` would be installed. Just start and enable
it:

```
# systemctl start hwth-watchmark #or service hwth-watchmark start
# systemctl enable hwth-watchmark #or update-rc.d hwth-watchmark
```

If that service is not registered, you would find a copy of the systemd
configuration in `/usr/share/doc/highwaytohell/hwth-watchmark.service`,
while non-systemd users may just symlink `/usr/bin/hwth-matchmark` to
`/etc/init.d/hwth-watchmark`.

Ensure watchmark service is running:

```
# hwth-watchmark status
watching via 22827
```

Checking activity:

```
# cat /var/log/highwaytohell/hwth-watch.log
started inotify on Thu Aug 10 14:08:20 UTC 2017
reloading on Thu Aug 10 14:21:05 UTC 2017
killed inotify on Thu Aug 10 14:25:43 UTC 2017
started inotify on Thu Aug 10 14:26:01 UTC 2017
```

FIXME: resolving NSs in charge for a zone, we have a
       `SELECT fqdn FROM nspools WHERE tag IN ('master', 'backup')`. It gives
       us the pair of nameserver FQDNs to include generating a zone. Now note
       that when your nspool tag name alphabetically succeeds your bkppool tag
       name, then SELECT would return nameserver FQDNs such as your bkppool
       would actually be considered to be your nspool, and vice versa.
FIXME: ensure confQueue & zonesQueue are not applying some change simultaneously
       (some kind of lock ...)
DISCUSS: do we need keeping plaintext zones when using DNSSEC?
DISCUSS: we assume running name server on that worker, we could split it
       so a worker generates (& signs) zones (without necessarily running
       a name server locally), while an other one would only gets stuff we
       know passed checkzone (& got signed) then actually restarting their
       name server. Note: the generation/signature process does involve a
       checkzone that implies nsd or bind utils where installed, regardless
       of being name servers.

### checkHealth

A second class of worker is in charge of running health checks. `checkHealth`
setups a couple schedules.
The first one iterates over the health checks declared in Cassandra, running
those that need to be refreshed and adding records to our health checks history
table.
And the second one purges older records from that history table.

### outboundNotifier

This class of worker would be listening for events from our other workers,
eventually sending HTTP POST, GET, SMS or email notifications.

The `checkHealth` worker may schedule notification settings to be checked for
matching configurations, having refreshed a check status.

The `apiGW` worker may schedule login history to be checked notifying user
his account was accessed.

FIXME: SMS

### apiGW

Minimalist API gateway (we've proven it can be done ... I don't necessarily
enjoy customizing CSSs), with token authentication, 2FA-capable.

FIXME: dont res.send.(errorcode) if req.sessions.userid: instead render a
       common template
FIXME: error & confirmation pages back links & labels

## CLI

Having deployed an API gateway, a sample API client can be found in
`samples.d/butters`. Install it where you would be able to execute it - debian
packaging currently installs it as `/usr/bin/butter`.

That client assumes you have a valid API token. This may be created via the
apiGW web UI - or by inserting a user in your Cassandra keyspace - refer to
./db/cassandra.test for a concrete sample - you do not necessarily need the
account record in Cassandra to involve a valid email address or passphrase...

Token and endpoint configuration should be defined in your `~/.butters.cfg`.
Use `samples.d/butters.cfg.sample` configuring your token, user ID, gateway
address and proto.

```
$ butters -h
Usage: butters [OPTION]
    Interacts with HighWayToHell API Gateway

    auth options:
      -u, --userid	user ID authenticating against API gateway
      --token		token authenticating against API gateway

    generic options:
      -a, --action	list, get, add, edit, del, defaults to list
      --debug		debug config before querying API gateway
      -d, --domain	domain to work with, defaults to example.com
      -R, --ressource	domains, records, healthchecks, healthhistory
			defaults to domains
      -r, --record	record name, defaults to www
      -T, --target	record or health check target
			https://1.2.3.4/ping (when checktype is http)
			8.8.8.8 (when checktype is icmp)
      -t, --type	A, AAAA, CNAME, TXT, NS, defaults to A

    options specific to domains:
      --disablednssec	disables DNSSEC on domain
      --enablednssec	enables DNSSEC on domain
      --getdsrecords	fetches DS records for domain

    options specitic to contacts:
      --contacttype     contact type, smtp or sms, defaults to smtp
      -T, --target	email or phone number

    options specific to health checks:
      --checkid		defines healthcheck to edit or remove
      --checktype	defines healthchecks type, defaults to http
      --header		defines healthcheck Host header
      --healthy		defines healthcheck healthy threshold
      --unhealthy	defines healthcheck unhealthy threshold
      -i, --invert	invert health check return value
      -m, --match	health check string match, defaults to none
			which would rely on http code

    options specific to notifications:
      --notifydown	notifies after N unhealthy checks
      --notifytarget    URL, email address or phone number (with country code)
      --notifyup	notifies after N healthy checks
      --notifyvia	either http-post, http-get, smtp or sms

    options specific to records:
      --priority        record priority, defaults to 10
      --setid		defines a set ID - dealing with multiple records
			with identic names
      --ttl		sets record TTL, defaults to 3600
$ butters
[{"origin":"peerio.com","idowner":42,"authrefresh":null,"failrefresh":null,"ksk":"Kpeerio.com.+007+21300","kskdata":null,"lastttl":1,"negrefresh":null,"ns":null,"nspool":"default","refresh":null,"serial":"150178821015","zsk":"Kpeerio.com.+007+12410","zskdata":null},{"origin":"peerio.biz","idowner":42,"authrefresh":null,"failrefresh":null,"ksk":"Kpeerio.biz.+007+46485","kskdata":null,"lastttl":1,"negrefresh":null,"ns":null,"nspool":"default","refresh":null,"serial":"150161166270","zsk":"Kpeerio.biz.+007+39278","zskdata":null}]
$ butters -d example.com -a add
domain example.com created
$ butters -d example.com -a del
domain example.com dropped
$ butters -d peerio.com -a get
{"origin":"peerio.com","idowner":42,"authrefresh":null,"failrefresh":null,"ksk":"Kpeerio.com.+007+21300","kskdata":null,"lastttl":1,"negrefresh":null,"ns":null,"nspool":"default","refresh":null,"serial":"150178821015","zsk":"Kpeerio.com.+007+12410","zskdata":null}
$ butters -d peerio.biz -a get -R records -r account
[{"origin":"peerio.biz","type":"A","name":"account","setid":"icebear-account-A","healthcheckid":0,"priority":0,"target":"54.198.78.160","ttl":null},{"origin":"peerio.biz","type":"A","name":"account","setid":"icebear-account-B","healthcheckid":0,"priority":0,"target":"52.72.185.246","ttl":null}]
$ butters -d peerio.com -a edit --disablednssec
{}
$ butters -d peerio.com -a edit --enablednssec
true
$ butters -d peerio.com -a add -R healthchecks -T https://52.72.185.246/v2/ping
"ab013e30-7941-11e7-a5d2-38dbe520a4b3"
$ butters -d peerio.com -a edit -R healthchecks -T https://54.198.78.160/v2/ping --checkid ab013e30-7941-11e7-a5d2-38dbe520a4b3 --header mailvirginia.peerio.com --match OK
ab013e30-7941-11e7-a5d2-38dbe520a4b3
$ butters -d peerio.com -a add -R healthchecks -T https://52.72.185.246/v2/ping  --header mailvirginia.peerio.com --match OK
"972aefc0-7944-11e7-83c0-2f6aec752731"
$ butters -d peerio.com -R healthchecks
[{"uuid":"ab013e30-7941-11e7-a5d2-38dbe520a4b3","origin":"peerio.com","headers":"mailvirginia.peerio.com","invert":false,"match":"OK","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/v2/ping","type":"http"},{"uuid":"e2f2dfb0-7928-11e7-abc0-01fda1e91471","origin":"peerio.com","headers":"icebear.peerio.com","invert":false,"match":"OK","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://52.72.185.246/ping","type":"http"},{"uuid":"e2f2dfb1-7928-11e7-8053-9262b9b8e1d4","origin":"peerio.com","headers":"iceblobvirginia.peerio.com","invert":false,"match":"OK","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/ping","type":"http"},{"uuid":"e2f2b8a0-7928-11e7-ae80-88f52efeea60","origin":"peerio.com","headers":"icebear.peerio.com","invert":false,"match":"OK","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/ping","type":"http"},{"uuid":"972aefc0-7944-11e7-83c0-2f6aec752731","origin":"peerio.com","headers":"mailvirginia.peerio.com","invert":false,"match":"OK","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://52.72.185.246/v2/ping","type":"http"},{"uuid":"e2f2dfb2-7928-11e7-91c1-ed90532c5f11","origin":"peerio.com","headers":"iceblobvirginia.peerio.com","invert":false,"match":"OK","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://52.72.185.246/ping","type":"http"}]
$ butters -d peerio.com -a get -R healthchecks --checkid ab013e30-7941-11e7-a5d2-38dbe520a4b3
{"uuid":"ab013e30-7941-11e7-a5d2-38dbe520a4b3","origin":"peerio.com","headers":"mailvirginia.peerio.com","invert":false,"match":"OK","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/v2/ping","type":"http"}
$ butters -d peerio.com -a add -R records -r mailvirginia -T 52.72.185.246 --checkid 972aefc0-7944-11e7-83c0-2f6aec752731 --priority 10 --ttl 4200 --setid icebear-mail-B
mailvirginia.peerio.com
$ butters -d peerio.com -a add -R records -r mailvirginia -T 54.198.78.160 --checkid ab013e30-7941-11e7-a5d2-38dbe520a4b3 --priority 20 --ttl 42000 --setid icebear-mail-A
mailvirginia.peerio.com
$ butters -d peerio.com -a get -R records --record mailvirginia
[{"origin":"peerio.com","type":"A","name":"mailvirginia","setid":"icebear-mail-A","healthcheckid":"ab013e30-7941-11e7-a5d2-38dbe520a4b3","priority":10,"target":"54.198.78.160","ttl":3600},{"origin":"peerio.com","type":"A","name":"mailvirginia","setid":"icebear-mail-B","healthcheckid":"972aefc0-7944-11e7-83c0-2f6aec752731","priority":10,"target":"52.72.185.246","ttl":3600}]
$ butters -d peerio.com -a add -R records -r @ -T mailvirginia.peerio.com -t MX --priority 10
peerio.com
$ butters -d peerio.com -a del -R healthchecks --checkid 251ccb60-7953-11e7-834f-ecf6eb15c0e2
{}
$ butters -d peerio.com -a del -R records --record totoplouf
{}
$ butters -d peerio.com -a get -R healthhistory --checkid e2f2dfb2-7928-11e7-91c1-ed90532c5f11
[{"when":"1501879710062","value":true},{"when":"1501879785050","value":true}]
$ butters -R contacts -a add -T myaddress@example.com
check your emails
$ butters -R contacts
[{"type":"smtp","target":"myaddress@example.com","active":"yes"}]
$ butters -R notifications -d peerio.com -a add --checkid e2f2dfb0-7928-11e7-abc0-01fda1e91471 --notifytarget myaddress@example.com --notifyvia smtp
e2f2dfb0-7928-11e7-abc0-01fda1e91471
$ butters -R notifications -d peerio.com -a del --checkid e2f2dfb0-7928-11e7-abc0-01fda1e91471
OK
$ butters -R notifications -d peerio.com
[{"idcheck":"ab013e30-7941-11e7-a5d2-38dbe520a4b3","notifydownafter":2,"notifydriver":"http-post","notifytarget":"https://hooks.slack.com/services/SOMEINCOMINGWEBHOOKTARGETURL","notifyupafter":3}]
$ butters -R notifications
[]
$ butters -d peerio.com -a get --getdsrecords
peerio.com.	259200	IN	DS	105 7 1 92776cd91c4c4a2de34c94a6526660a0ce070897
peerio.com.	259200	IN	DS	105 7 2 e55e482c5b9782c7ac1f6e052bf5b37c3087600c8100d588a989570cec1dffa6
```

## Special Thanks

 * First and foremost [PeerioTechnologies](https://www.peerio.com), my current employer
 * As well as [Clement Duhart](https://github.com/slash6475), for introducing me to NodeJS
 * [StackOverflow](https://stackoverflow.com), answering my most obscure questions
