# amqp-wsk-feed

An [AMQP](https://www.amqp.org/) package for [OpenWhisk](https://github.com/openwhisk/openwhisk), providing a connection feed for messages from AMQP sources.  This package is heavily based on the OpenWhisk Alarms package and is designed to run along side it or deployed separately.  It requires an already existing CouchDB service to provide persistence.

Each [trigger](https://github.com/openwhisk/openwhisk/blob/master/docs/triggers_rules.md) that uses the AMQP feed service is assigned a dedicated [rhea Receiver](https://github.com/grs/rhea#receiver) for message flow and delivery.  Messages are accepted once they have been successfully forwarded to the trigger.  OpenWhisk then distributes the message to any [actions](https://github.com/openwhisk/openwhisk/blob/master/docs/actions.md) activated by the trigger.

## Deployment

This package has two parts: the AMQP feed service and associated OpenWhisk feed actions which control the lifecycle of individual feeds.  The former is a Node.js application that can be run in a docker image.  The latter two are an OpenWhisk Action and related OpenWhisk Web Action that provide the necessary OpenWhisk API requirements for managing the connection feed in a secure manner.

Currently, this package has only been tested within an OpenWhisk instance running on OpenShift.  In the case that you have installed OpenWhisk using https://github.com/projectodd/openwhisk-openshift and the deployment has completed successfully, you can run a (non-scaling) version of the feed provider by executing the script: deploy/ocWhiskSystem.sh.  This will create and deploy a local docker image of the AMQP feed provider and configure the AMQP package.  Alternatively, if you wish to use pre-made images, you can deploy using the openshift template:

```
$ oc process -f deploy/openshift/amqp-template.yml | oc create -f -
```

With slight modification it should be possible to deploy the AMQP connection feed to Kubernetes or to any arbitrary docker runtime.  Installing by hand requires obtaining the necessary OpenWhisk secrets required by the [Alarms package installer](https://github.com/apache/incubator-openwhisk-package-alarms/blob/master/installCatalog.sh) and running the commands while changing the named "alarm" references for corresponding 'amqp' named entities.

### Running the AMQP connection feed in a Docker container

To build the feed, copy this repository to a subdirectory, e.g. "amqpprovider".

```
$ docker build --tag foo/bar amqpprovider
$ export DB_PREFIX=whisk_amqp_
$ export ROUTER_HOST=openwhisk-myproject.192.168.42.216.nip.io
$ export DB_USERNAME=dbname
$ export DB_PASSWORD=secret
$ export DB_HOST=172.30.93.156:5984
$ export DB_PROTOCOL=http
$ export AUTH_WHISK_SYSTEM=some:long_string
$ export CONTROLLER_HOST=controller
$ export CONTROLLER_PORT=8080
$ 
$ docker run -e ROUTER_HOST=openwhisk-myproject.192.168.42.216.nip.io -e DB_USERNAME=the_name -e DB_HOST=172.30.93.156:5984 -e DB_PASSWORD=the_pw -e DB_PROTOCOL=http -e DB_PREFIX=whisk_amqp_ -it foo/bar node /amqpTrigger/app.js
$ amqpprovider/installCatalog.sh ${AUTH_WHISK_SYSTEM} http://${CONTROLLER_HOST}:${CONTROLLER_PORT} ${DB_PROTOCOL}://${DB_HOST} ${DB_PREFIX} ${ROUTER_HOST}
```


## Usage

Create your own custom action, trigger and rule.

```js
// msglog.js
function main(params) {
    if (params.type == 'message' {
        console.log('inbound message with body', params.body);
    }
    else if (params.type == 'feed_error') {
        console.log('AMQP feed error', params.error);   // bad credentials, wrong address...
        console.log('The feed is disabled and must be re-created to resume');
    }
    return {payload: ''};
}
```

```
$ wsk action create msglog msglog.js
$ wsk trigger create trig_01 --feed amqp/amqpfd -p address queue_99 -p connection_options '{"host": "broker6.myorg.com", "port": 5672 }'
$ wsk rule create rule_7 trig_01 msglog
```

There will be one invocation of the msglog action for each inbound message processed by the feed.  Several instances of the msglog action may run concurrently.  While the inbound messages from the rhea Receiver are delivered in order to the OpenWhisk trigger, there is no guaranteed order in which they are processed by the related OpenWhisk action invocations.

In the above example the message passes from the feed => trig_01 => rule_7 => msglog in a simple pipeline fashion.  OpenWhisk allows much more complicated combinations of triggers, rules and actions which could lead to the message being processed by multiple actions in series or in parallel.

The 'connection_options' argument can be composed of any valid connection options used by the rhea AMQP client.

Multiple Receivers to the same AMQP host will share a connection if the connection options are identical and the trigger is created from the same OpenWhisk namespace by the same OpenWhisk user.  Setting a "feed_tag" property on the connection_options can restrict this connection sharing only to other Receivers with the same feed_tag string value.

## Advanced usage

TODO: Note low level API use to configure the feed/rules/triggers and how to avoid message loss on setup.

## Enhancements coming real soon now

 - easy deployment to Kubernetes/Docker
 - self test
 - provide a mechanism for request/response round-trip using the AMQP feed provider
 - add an UPDATE feed lifecycle event for dynamic credit, or maybe PAUSE/UNPAUSE