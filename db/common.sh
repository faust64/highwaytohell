#!/bin/sh

if test -s /var/lib/highwaytohell/.profile; then
    . /var/lib/highwaytohell/.profile
fi
if test -z "$CASSANDRA_HOST"; then
    echo missing cassandra configuration >&2
    exit 1
elif ! cqlsh --version >/dev/null 2>&1; then
    echo cqlsh may not be installed - not in PATH >&2
    exit 1
fi
test -z "$CASSANDRA_KEYSPACE" && export CASSANDRA_KEYSPACE=hwth
if test "$CQLSH_VERSION"; then
    export CQLSH_ARGS="--cqlversion=$CQLSH_VERSION `echo $CASSANDRA_HOST | awk '{print $1}'`"
else
    export CQLSH_ARGS="`echo $CASSANDRA_HOST | awk '{print $1}'`"
fi
