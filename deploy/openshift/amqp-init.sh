#!/bin/bash

set -a
if [ -e /amqpprovider_config/env ]; then
    source /amqpprovider_config/env
fi

echo "Waiting for controller to be available"
until $(curl --output /dev/null --silent --head --fail http://${CONTROLLER_HOST}:${CONTROLLER_PORT}/ping); do printf '.'; sleep 1; done

cd /openwhisk-package-amqp
./installCatalog.sh ${AUTH_WHISK_SYSTEM} http://${CONTROLLER_HOST}:${CONTROLLER_PORT} ${DB_PROTOCOL}://${DB_HOST} ${DB_PREFIX} ${ROUTER_HOST}
