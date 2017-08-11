#!/bin/sh

DB_DIR=/var/lib/cassandra/data
DUMP_DIR=/media/backups
NTOOL=`which nodetool 2>/dev/null`
RSYNC=`which rsync 2>/dev/null`

BACKUP_MARK=$DUMP_DIR/.mark  # say you want to setup nagios probes checking backups ...
CASSANDRA_HOST=CASSANDRAADDR # we set an address for nodetool/cqlsh: yet we need to run on a Cassandra host (rsync)
CASSANDRA_PORT=7199
DUMP_ID="`date +%Y_%m_%d_%H%M`"

DONTOVERWRITE=true
SNAPDIR="$DUMP_DIR/$DUMP_ID/SNAPSHOTS"
SCHEMADIR="$DUMP_DIR/$DUMP_ID/SCHEMA"

if test -z "$RSYNC" -o -z "$NTOOL"; then
    echo missing dependencies >&2
    exit 1
fi
for d in "$SCHEMADIR" "$SNAPDIR"
do
    if test -d "$d"; then
	echo "$d already exists"
	if $DONTOVERWRITE; then
	    exit 1
	fi
    else
	mkdir -p "$d"
    fi
done

cqlsh $CASSANDRA_HOST -e "SELECT keyspace_name FROM system_schema.keyspaces" 2>/dev/null| grep -vE '^($|[ ]*keyspace_name|---|.*rows\))' | while read ks
    do
	mkdir -p "$SCHEMADIR/$ks"
	if ! $NTOOL -h $CASSANDRA_HOST -p $CASSANDRA_PORT snapshot $ks >/dev/null 2>&1; then
	    echo failed snapshotting $ks >&2
	    continue
	elif ! cqlsh $CASSANDRA_HOST -e "DESC KEYSPACE $ks" >"$SCHEMADIR/$ks/schema.cql" 2>/dev/null; then
	    echo failed dumping schema for $ks >&2
	    continue
	fi
	find "$DB_DIR/$ks" -type d -name snapshots | while read snap
	    do
		ddir=`echo "$snap" | sed "s|^$DB_DIR/*\(.*\)/snapshots|\1|"`
		mkdir -p "$SNAPDIR/$ddir/"
		$RSYNC -avWxP --numeric-ids "$snap/" "$SNAPDIR/$ddir/"
	    done && echo "$DUMP_ID:$ks OK" >>$BACKUP_MARK
    done

if ! $NTOOL -h $CASSANDRA_HOST -p $CASSANDRA_PORT clearsnapshot; then
    echo failed clearing snapshots >&2
fi

exit $?
