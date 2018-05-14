#!/bin/bash
#
# use the command line interface to install standard actions deployed
# automatically
#
# To run this command
# ./installCatalog.sh <authkey> <edgehost> <dburl> <dbprefix> <apihost> <workers>

set -e
set -x

: ${OPENWHISK_HOME:?"OPENWHISK_HOME must be set and non-empty"}
WSK_CLI="$OPENWHISK_HOME/bin/wsk"

if [ $# -eq 0 ]; then
    echo "Usage: ./installCatalog.sh <authkey> <edgehost> <dburl> <dbprefix> <apihost> <workers>"
fi

AUTH="$1"
EDGEHOST="$2"
DB_URL="$3"
DB_NAME="${4}amqpservice"
APIHOST="$5"
WORKERS="$6"
LIMIT_CRON_FIELDS="${LIMIT_CRON_FIELDS}"

# If the auth key file exists, read the key in the file. Otherwise, take the
# first argument as the key itself.
if [ -f "$AUTH" ]; then
    AUTH=`cat $AUTH`
fi

# Make sure that the EDGEHOST is not empty.
: ${EDGEHOST:?"EDGEHOST must be set and non-empty"}

# Make sure that the DB_URL is not empty.
: ${DB_URL:?"DB_URL must be set and non-empty"}

# Make sure that the DB_NAME is not empty.
: ${DB_NAME:?"DB_NAME must be set and non-empty"}

# Make sure that the APIHOST is not empty.
: ${APIHOST:?"APIHOST must be set and non-empty"}

PACKAGE_HOME="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

export WSK_CONFIG_FILE= # override local property file to avoid namespace clashes

echo Installing AMQP package.

$WSK_CLI -i --apihost "$EDGEHOST" package update --auth "$AUTH" --shared yes amqp \
     -a description 'AMQP message trigger facility' \
     -a parameters '[ {"name":"address", "required":true} ]' \
     -p apihost "$APIHOST"

# make amqpFeed.zip
cd action

if [ -e amqpFeed.zip ]; then
    rm -rf amqpFeed.zip
fi

cp -f amqpFeed_package.json package.json
zip -r amqpFeed.zip lib package.json amqp.js

$WSK_CLI -i --apihost "$EDGEHOST" action update --kind nodejs:6 --auth "$AUTH" amqp/amqpFeed "$PACKAGE_HOME/action/amqpFeed.zip" \
     -a description 'Fire trigger on inbound message from an AMQP source' \
     -a parameters '[ {"name":"address", "required":true}, {"name":"otherArg", "required":false}, {"name":"arg3", "required":false} ]' \
     -a feed true

COMMAND=" -i --apihost $EDGEHOST package update --auth $AUTH --shared no amqpWeb \
    -p DB_URL $DB_URL \
    -p DB_NAME $DB_NAME \
    -p apihost $APIHOST"

# Not yet implemented.  Requires ability to select worker with already open
# shared/shareable AMQP connection.
#if [ -n "$WORKERS" ]; then
#    COMMAND+=" -p workers $WORKERS"
#fi

$WSK_CLI $COMMAND

# make amqpWebAction.zip
cp -f amqpWeb_package.json package.json
npm install

if [ -e amqpWebAction.zip ]; then
    rm -rf amqpWebAction.zip
fi

zip -r amqpWebAction.zip lib package.json amqpWebAction.js node_modules

$WSK_CLI -i --apihost "$EDGEHOST" action update --kind nodejs:6 --auth "$AUTH" amqpWeb/amqpWebAction "$PACKAGE_HOME/action/amqpWebAction.zip" \
    -a description 'Create/Delete a trigger in AMQP provider Database' \
    --web true





