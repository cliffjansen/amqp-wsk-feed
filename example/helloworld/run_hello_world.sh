# This example:
#   - downloads and runs a Docker image of the Apache Artemis broker
#   - connects an OpenWhisk trigger to the broker's queue: "hello_q"
#   - configures the trigger to call an OpenWhisk action: "message_feed_logger"
#   - sends a message to the broker to populate its hello_q
#   - polls to confirm the message activates the OpenWhisk action
#
# This example assumes that you have deployed this project's feed
# provider service and installed its OpenWhisk packages as described
# in the main README.  It also assumes you have the npm command
# available to find node.js packages.  It also assumes it can use the
# docker command to pull and run the Artemis image.
#
# Run this script as follows:
# 
#   $ sh run_hello_world.sh wsk_api_host_port wsk_auth_token
#
# where wsk_api_host_port is the "--apihost" argument to the OpenWhisk
# "wsk" command and wsk_auth_token is the "--auth" argument to the
# "wsk" command.

trap cleanup 1 2 3 6

cleanup()
{
  [ z = z"$DOCKER_PID" ] || docker kill $DOCKER_PID
  exit 1
}

# First, a bunch of sanity tests

APIHOST=$1
AUTH=$2
[ z = z"$AUTH" ] && { echo "Usage: sh run_hello_world.sh wsk_api_host_port wsk_auth_token" >&2 ; exit 1 ; }

[ -f message_logger.js -a -d amqp_send ] || { echo please change working directory to the script location >&2; exit 1; }
(cd amqp_send && npm install) || { echo cannot fetch the amqp_send package dependencies >&2; exit 1; }
(rm -f amqpSend.zip && cd amqp_send && zip -qr ../amqpSend .) || { echo cannot create the amqp_send action >&2; exit 1; }

wsk --help >/dev/null 2>&1 || { echo cannot find '"wsk"' command >&2; exit 1; }
WSK_CMD="wsk -i --apihost $APIHOST --auth $AUTH"
$WSK_CMD list >/dev/null || { echo cannot execute $WSK_CMD >&2; exit 1; }
# OpenWhisk triggers and rules behave differently on update from actions
$WSK_CMD trigger list | grep hello_trigger >/dev/null &&
  { echo Please delete existing trigger hello_trigger before proceeding >&2; exit 1; }
$WSK_CMD trigger list | grep hello_rule >/dev/null &&
  { echo Please delete existing rule hello_rule before proceeding >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo cannot run docker >&2; exit 1; }


# Pull and run Artemis broker
ARTEMIS_IMG=vromero/activemq-artemis
echo "image pull for $ARTEMIS_IMG"
docker pull $ARTEMIS_IMG || { echo image pull failed >&2; exit 1; }
DOCKER_PID=`docker run -d --rm -p 8161 -p 5672 $ARTEMIS_IMG`
[ z = z"$DOCKER_PID" ] && exit 1
while ! docker logs $DOCKER_PID 2>&1 | grep 'Artemis Console available at' >/dev/null
do
  echo waiting for broker to initialize
  sleep 1
done

AMQP_PORT=`docker port $DOCKER_PID 5672 | sed 's/^.*://'`
if [ z = z"$DOCKER_HOST" ] ; then
  AMQP_HOST=`docker port $DOCKER_PID 5672 | sed 's/:.*//'`
else
  AMQP_HOST=`echo $DOCKER_HOST | sed 's_tcp://__' | sed 's/:.*//'`
fi

# Create our trigger.  username and password are as documented for this Docker image.

$WSK_CMD trigger create hello_trigger --feed /whisk.system/amqp/amqpFeed -p address hello_q -p connection_options \
   '{"host": "'$AMQP_HOST'", "port": "'$AMQP_PORT'" , "username": "artemis", "password": "simetraehcapa" }' ||
      { echo trigger creation failed >&2; exit 1; }


# Connect it to our message logger

$WSK_CMD action update amqp_message_logger message_logger.js
$WSK_CMD rule create hello_rule hello_trigger amqp_message_logger

# A helper action, so we can put a message into the broker for this example
$WSK_CMD action update amqpSend --kind nodejs:6 amqpSend.zip

# send a message with brief delay for activation poll command that follows

( sleep 2
  if $WSK_CMD action invoke --result amqpSend --param host $AMQP_HOST --param port $AMQP_PORT --param node hello_q --param user artemis --param pass simetraehcapa --param body 'hello from AMQP to OpenWhisk'
  then
    echo; echo expect message any moment,  then enter Ctrl-c to exit; echo
  else
    echo sending test message failed
  fi
) &

# monitor the message logger

$WSK_CMD activation poll amqp_message_logger --since-seconds 1

cleanup
