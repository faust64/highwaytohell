# HighWayToHell - QuickStart

Table of Contents
=================

  * [HighWayToHell](#highwaytohell---quickstart)
    * [Build Package](#build-package)
    * [Download Package](#download-package)
    * [Install Package](#install-package)
    * [Databases](#databases)
      * [Redis](#redis)
      * [Cassandra](#cassandra)
      * [Clients](#clients)
    * [Declare Pools](#declare-pools)
    * [Configure Workers](#configure-workers)
    * [DNS Driver](#dns-driver)
    * [Frontend](#frontend)
    * [CLI](#cli)

## Build Package

Cloning from GitHub:

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
$ ls -1 ../
highwaytohell
highwaytohell_0.0.1-1_all.deb
highwaytohell_0.0.1-1_amd64.changes
highwaytohell_0.0.1-1.debian.tar.gz
highwaytohell_0.0.1-1.dsc
highwaytohell_0.0.1.orig.tar.gz
```

## Download Package

Alternatively, releases would eventually be pushed to GitHub:

```
$ wget https://github.com/faust64/highwaytohell/releases/download/0.0.1/highwaytohell_0.0.1-1_all.deb
```

## Install Package

Having downloaded or build package, we would install it to our first worker.
Let's assume that worker will also be running our DNS server (`nsd`)

```
# apt-get update ; apt-get install rsync gcc g++ ldnsutils nsd
# dpkg -i highwaytohell_0.0.1-1_all.deb
```

Untested yet, net you may also use `bind` as your DNS server:

```
# apt-get update ; apt-get install rsync gcc g++ dnsutils bind
# dpkg -i highwaytohell_0.0.1-1_all.deb
```

Scaling out, note that only our `refreshZones` workers would require these DNS
utils to be installed. You may stick to `rsync`, `gcc` and `g++` deploying
the `outboundNotifier`, `checkHealth` or `apiGW` ones.

## Databases

### Redis

If you do not have a Redis server running yet, consider installing
`redis-server` on some instance your workers would have access to. Using a
master/slave setup is recommended (see `samples.d/redis/prod/redis.conf` and
`samples.d/redis/prod/sentinel.conf`), behind some `haproxy` layer (see
`samples.d/haproxy/redis.cfg`).

Distributing your setup, we would be referring to pools of workers: note that
it is recommended each pool includes its own Redis setup.

### Cassandra

If you do not have a Cassandra setup running yet, consider deploying one.
A single-instance should do, although we would recommend using a cluster.

See https://wiki.apache.org/cassandra/DebianPackaging

If you are not yet familiar with Cassandra, DataSax documentations should point
out what kind of setup better suites your requirements. A sample configuration
is included (`samples.d/cassandra/cassandra.yaml`) setting the
`GossipingPropertyFileSnitch` `endpoint_snitch`, which would allow you to
set your nodes `dc` and `rack` attributes via `cassandra-rackdc.properties`.

Having your Cassandra cluster running, the next step is to add a keyspace. Look
for `db/cassandra.init` (`/usr/share/highwaytohell/db/cassandra.init`) to
create one and install our initial tables. The `CREATE KEYSPACE` line *will*
need to be changed - unless running a test setup.

### Client

To ensure our package postinstall scripts may eventually upgrade Cassandra
tables schemas, you will want NodeJS workers to have `cqlsh` installed
and able to dump and import tables.

Ensure the following command does not return an error:

```
$ echo 'use hwth; COPY records TO STDOUT;' | cqlsh IPADDR
```

If the previous fails with something like:

```
Connection error: ('Unable to connect to any servers', {'IPADDR':
    ProtocolError("cql_version '3.3.1' is not supported by remote (w/ native protocol).
    Supported versions: [u'3.4.4']",)})
```

Then, try with `3.4.4` instead:

```
$ echo 'use hwth; COPY records TO STDOUT;' | cqlsh --cqlversion=3.4.4 IPADDR
```

If it still does not work: avoid installing `cqlsh` from PIP: instead install
Cassandra server package on your NodeJS workers - make sure service won't start,
sadly there is no client-only package ...

## Declare Pools

Consider the following sample list of name servers:

| IP      | FQDN            | pool  |
| :-----: | :-------------: | :---: |
| 1.1.1.1 | ns1.example.com | poolA |
| 1.1.1.2 | ns1.example.com | poolA |
| 1.1.2.1 | ns2.example.com | poolB |
| 1.1.2.2 | ns2.example.com | poolB |
| 1.1.3.1 | ns3.example.com | poolC |
| 1.1.3.2 | ns3.example.com | poolC |

You may not want to have several nameservers per pool - note it is possible.
You would probably want more than a pool. Our defaults would assume a `default`
and a `backup` pools are defined.

Before configuring our workers, we would want to register our pools into
Cassandra. There is no tool automating this: we would need to insert a pool
tag name associated to a FQDN (so end-user knows where to point his NS
delegation).

```
$ cqlsh $CASSANDRA_HOST
cqlsh> use hwth;
cqlsh:hwth> INSERT INTO nspools (tag, fqdn) VALUES ('default', 'ns1.example.com');
cqlsh:hwth> INSERT INTO nspools (tag, fqdn) VALUES ('dc2', 'ns2.example.com');
cqlsh:hwth> INSERT INTO nspools (tag, fqdn) VALUES ('dc3', 'ns3.example.com');
```

## Configure Workers

Give a look to `/var/lib/highwaytohell/.profile-sample`. Install your own
copy as `/var/lib/highwaytohell/.profile` updating variables according to
your own setup. The one you would definitely want to set being:

 * `CASSANDRA_HOST`: FQDNs or IPs list
 * `CASSANDRA_KEYSPACE`: name of previously-created keyspace
 * `CQLSH_VERSION`: only if you needed to set `--cqlversion` earlier
 * `HWTH_HOSTNAME`: formatting links, hostname to show
 * `HWTH_PROTO`: formatting links, proto to show
 * `HWTH_POOL`: the pool name (as declared earlier) your worker is serving for
 * `HWTH_BACKUP_POOL`: the backup pool name (registering new zones)
 * `REDIS_HOST`: FQDN or IP
 * `REDIS_HOST_backup`: (assuming `HWTH_BACKUP_POOL=backup`) identifies a
   separate backend running queues related to your `backup` pool. Declare
   as much as you need, depending on your own pool names.
 * `SOA_CONTACT`: SOA-formatted email address to show in your zones
 * `MAIL_FROM`: formatting mails, FROM address
 * `MAIL_REPLYTO`: formatting mails, REPLYTO addres
 * `SMTP_HOST`: sending notification or registration mails, SMTP relay

Distributing your setup, also consider:

 * `RUN_WORKERS`: list of workers to run
 * `FORKS`: would start two processes of each by default

Having your own profile ready, install it (`/var/lib/highwaytohell/.profile`)
and make sure it can be read by `hwth` (`chmod 0644` should do, preferably
`root` owned).

The first time you install a worker, you will also want to upgrade the keyspace
we initialized earlier to whatever schema is required running our last version.
To apply all patches, from a worker, run:

```
# /usr/share/highwaytohell/db/updateScript
skipping db/0.0.1.patch
Using 1 child processes
Starting copy of hwth.upgtest with columns [idname, count, smthelse, value].
[Use . on a line by itself to end input]
Processed: 2 rows; Rate:       3 rows/s; Avg. rate:       5 rows/s
2 rows imported from 1 files in 0.394 seconds (0 skipped).
done
```

## DNS Driver

Last thing to check before starting your workers, whenever running alongside
a nameserver. We would need our NodeJS processes being able to instruct our
name server to reload its configuration (while NodeJS should not have such
privileges).

Assuming either `nsd` or `bind` was present when you installed `highwaytohell`,
then you would only need to start and enable `hwth-watchmark`:

```
# systemctl start hwth-watchmark #or service hwth-watchmark start
# systemctl enable hwth-watchmark #or update-rc.d hwth-watchmark
```

If that service is not registered, you would find a copy of the systemd
configuration in `/usr/share/doc/highwaytohell/hwth-watchmark.service`, while
non-systemd users may just symlink `/usr/bin/hwth-watchmark` to
`/etc/init.d/hwth-watchmark`. Start and enable `hwth-watchmark`. Make sure it is
running:

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

## Manage Processes

Once you're done configuring your workers, you may start them using `hwth`:

```
# hwth start
[...]
# hwth status
[info] checkHealth is running
[info] apiGW is running
[info] refreshZones is running
[info] outboundNotifier is running
# systemctl status pm2-hwth
[...]
# hwth restart refreshZones
```

You may use `pm2` commands assuming our runtime user privileges:

```
# su hwth -s /bin/bash
$ pm2 list
┌──────────────────┬────┬─────────┬───────┬────────┬─────────┬────────┬─────┬───────────┬──────┬──────────┐
│ App name         │ id │ mode    │ pid   │ status │ restart │ uptime │ cpu │ mem       │ user │ watching │
├──────────────────┼────┼─────────┼───────┼────────┼─────────┼────────┼─────┼───────────┼──────┼──────────┤
│ apiGW            │ 30 │ cluster │ 19330 │ online │ 0       │ 5h     │ 0%  │ 54.0 MB   │ hwth │ disabled │
│ apiGW            │ 31 │ cluster │ 19336 │ online │ 0       │ 5h     │ 0%  │ 56.3 MB   │ hwth │ disabled │
│ checkHealth      │ 4  │ cluster │ 16942 │ online │ 0       │ 7h     │ 0%  │ 60.3 MB   │ hwth │ disabled │
│ checkHealth      │ 5  │ cluster │ 16948 │ online │ 0       │ 7h     │ 0%  │ 55.2 MB   │ hwth │ disabled │
│ outboundNotifier │ 2  │ cluster │ 16893 │ online │ 0       │ 7h     │ 0%  │ 55.2 MB   │ hwth │ disabled │
│ outboundNotifier │ 3  │ cluster │ 16899 │ online │ 0       │ 7h     │ 0%  │ 53.0 MB   │ hwth │ disabled │
│ refreshZones     │ 8  │ cluster │ 17126 │ online │ 0       │ 7h     │ 0%  │ 49.3 MB   │ hwth │ disabled │
│ refreshZones     │ 9  │ cluster │ 17132 │ online │ 0       │ 7h     │ 0%  │ 45.0 MB   │ hwth │ disabled │
└──────────────────┴────┴─────────┴───────┴────────┴─────────┴────────┴─────┴───────────┴──────┴──────────┘
 Use `pm2 show <id|name>` to get more details about an app
```

## Frontend

Having started service, the apiGW worker should be listening on your loopback,
port 8080. Setup some reverse proxy (see `samples.d/nginx.conf` or
`/usr/share/doc/highwaytohell/nginx-vhost.conf.sample`). Access your virtualhost
root to create your initial account, check your mailbox for a confirmation link.

Note the default (`NODE_ENV=production`) makes the use of some x509 certificate
serving your API mandatory for users to eventually open a session.

Distributing your setup, you may use `haproxy` relaying traffic to Nginx (see
`samples.d/haproxy/apiGW.cfg`).

## CLI

Having deployed an API gateway, a sample API client can be found in
`samples.d/butters`. Debian packaging would install it as `/usr/bin/butter`.

That client assumes you have a valid API token. This may be created via the
apiGW web UI - or by inserting a user in your Cassandra keyspace - refer to
`./db/cassandra.test` for a concrete sample - you do not necessarily need the
account record in Cassandra to involve a valid email address or passphrase...

Token and endpoint configuration should be defined in your `~/.butters.cfg`.
Use `samples.d/butters.cfg.sample` (or
`/usr/share/doc/highwaytohell/butters.cfg.sample`) configuring your token, user
ID, gateway address, port and proto.

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
      --checkname       defines healthcheck label
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
[{"origin":"peerio.com","authrefresh":null,"failrefresh":null,"ksk":"Kpeerio.com.+007+21300","kskdata":null,"lastttl":1,"negrefresh":null,"ns":null,"nspool":"default","refresh":null,"serial":"150178821015","zsk":"Kpeerio.com.+007+12410","zskdata":null},{"origin":"peerio.biz","authrefresh":null,"failrefresh":null,"ksk":"Kpeerio.biz.+007+46485","kskdata":null,"lastttl":1,"negrefresh":null,"ns":null,"nspool":"default","refresh":null,"serial":"150161166270","zsk":"Kpeerio.biz.+007+39278","zskdata":null}]
$ butters -d example.com -a add
domain example.com created
$ butters -d example.com -a del
domain example.com dropped
$ butters -d peerio.com -a get
{"origin":"peerio.com","authrefresh":null,"failrefresh":null,"ksk":"Kpeerio.com.+007+21300","kskdata":null,"lastttl":1,"negrefresh":null,"ns":null,"nspool":"default","refresh":null,"serial":"150178821015","zsk":"Kpeerio.com.+007+12410","zskdata":null}
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
[{"uuid":"ab013e30-7941-11e7-a5d2-38dbe520a4b3","origin":"peerio.com","headers":"mailvirginia.peerio.com","invert":false,"match":"OK","name":"testlabel1","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/v2/ping","type":"http"},{"uuid":"e2f2dfb0-7928-11e7-abc0-01fda1e91471","origin":"peerio.com","headers":"icebear.peerio.com","invert":false,"match":"OK","name":"testlabel2","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://52.72.185.246/ping","type":"http"},{"uuid":"e2f2dfb1-7928-11e7-8053-9262b9b8e1d4","origin":"peerio.com","headers":"iceblobvirginia.peerio.com","invert":false,"match":"OK","name":"testlabel3","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/ping","type":"http"},{"uuid":"e2f2b8a0-7928-11e7-ae80-88f52efeea60","origin":"peerio.com","headers":"icebear.peerio.com","invert":false,"match":"OK","name":"testlabel4","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/ping","type":"http"},{"uuid":"972aefc0-7944-11e7-83c0-2f6aec752731","origin":"peerio.com","headers":"mailvirginia.peerio.com","invert":false,"match":"OK","name":"testlabel5","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://52.72.185.246/v2/ping","type":"http"},{"uuid":"e2f2dfb2-7928-11e7-91c1-ed90532c5f11","origin":"peerio.com","headers":"iceblobvirginia.peerio.com","invert":false,"match":"OK","name":"testlabel6","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://52.72.185.246/ping","type":"http"}]
$ butters -d peerio.com -a get -R healthchecks --checkid ab013e30-7941-11e7-a5d2-38dbe520a4b3
{"uuid":"ab013e30-7941-11e7-a5d2-38dbe520a4b3","origin":"peerio.com","headers":"mailvirginia.peerio.com","invert":false,"match":"OK","name":"testlabel1","nspool":"default","requirehealthy":3,"requireunhealthy":2,"target":"https://54.198.78.160/v2/ping","type":"http"}
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
[{"type":"smtp","target":"myaddress@example.com","active":"confirmed"}]
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
