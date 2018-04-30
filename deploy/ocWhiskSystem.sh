#!/bin/bash
#
# Install AMQP provider package in same manner as the Alarms package on OpenWhisk on OpenShift
#
# This script assumes:
#   Openwhisk is installed on OpenShift and includes the Alarms package
#   Docker is installed and currently configured to work with the OpenShift cluster
#     by "eval $(minishift docker-env)" or equivalent
#   The namespace is "openshift"

[ -f provider/lib/amqpUtils.js ] || { echo wrong working dir >&2 ; exit 1 ; }
type wsk >/dev/null || exit 1
type oc >/dev/null || exit 1
NAMESPACE=$(oc get deployment alarmprovider --template="{{.metadata.namespace}}")
[ X = X"$NAMESPACE" ] && { echo cannot determine Alarm provider namespace ; exit 1 ; }

# get environment vars from the Alarm provider
ALARMS_ID=`docker ps | grep alarmprovider | grep -v POD | sed 1q | awk '{print $1;}'`
[ -z "$ALARMS_ID" ] && { echo cannot find an Alarms docker instance >&2 ; exit 1 ; }
ENV_FILE=amqpprovider.env
rm -f $ENV_FILE
touch $ENV_FILE
chmod 600 $ENV_FILE

docker exec -i $ALARMS_ID bash -c 'env | egrep "^DB_HOST|^DB_PROTOCOL=|^DB_USERNAME=|^DB_PASSWORD="' >$ENV_FILE
[ `wc -l <$ENV_FILE` -eq 4 ] || { echo missing environment data >&2 ; exit 1 ; }

echo DB_PREFIX=whisk_amqp_ >>$ENV_FILE
API_HOST=$(oc get route/openwhisk --template="{{.spec.host}}" --namespace $NAMESPACE)
[ -z "$API_HOST" ] && { echo cannot determine OpenWhisk API_HOST >&2 ; exit 1 ; }
echo ROUTER_HOST=$API_HOST >>$ENV_FILE

# Set environment vars we just generated.  Not exported.
eval `cat $ENV_FILE`

# Create custom wsk command for system user
SAUTH=`oc get secret whisk.auth -o yaml | grep "system:" | awk '{print $2}' | base64 --decode`
wsk_cmd() { wsk -i --apihost $API_HOST --auth $SAUTH "$@" ; }

docker build --tag projectodd/amqpprovider:openshift-latest . || exit $?

oc run amqpprovider --image projectodd/amqpprovider:openshift-latest \
   --env=DB_PASSWORD="$DB_PASSWORD" \
   --env=DB_PROTOCOL="$DB_PROTOCOL" \
   --env=DB_USERNAME="$DB_USERNAME" \
   --env=DB_PREFIX="$DB_PREFIX" \
   --env=ROUTER_HOST="$ROUTER_HOST" \
   --env=DB_HOST="$DB_HOST"

# Intsall 2 Whisk packages.  amqpWeb is private, contains the secrets and backend.
# Package "amqp" is public and provides user access to the feed provider.

rm -f action/amqpWebAction.zip action/amqpFeed.zip

( cd action &&
  rm -rf node_module &&
  cp -f amqpWeb_package.json package.json &&
  npm install &&
  zip -r amqpWebAction.zip lib package.json amqpWebAction.js node_modules)  || exit 1

DB_URL="$DB_PROTOCOL"://"$DB_HOST"
DB_NAME="$DB_PREFIX"amqpservice

wsk_cmd package update --shared no amqpWeb -p DB_URL $DB_URL -p DB_NAME $DB_NAME -p apihost $API_HOST

wsk_cmd action update --kind nodejs:6 amqpWeb/amqpWebAction action/amqpWebAction.zip -a description 'Create/Delete a trigger in AMQP provider Database' --web true

( cd action &&
  rm -rf node_module &&
  npm install &&
  cp -f amqpFeed_package.json package.json &&
  zip -r amqpFeed.zip lib package.json amqp.js ) || exit 1

wsk_cmd package update --shared yes amqp -a description 'AMQP message trigger facility' -a parameters '[ {"name":"notYetImplemented", "required":false} ]' -p apihost "$API_HOST" -p notYetImplemented 'patience grasshopper'

wsk_cmd action update --kind nodejs:6 amqp/amqpFeed action/amqpFeed.zip -a description 'Fire trigger on inbound message from an AMQP source' -a parameters '[ {"name":"address", "required":true}, {"name":"otherArg", "required":false}, {"name":"arg3", "required":false} ]' -a feed true
