# amqp-wsk-feed

An [AMQP](https://www.amqp.org/) package for [OpenWhisk](https://github.com/openwhisk/openwhisk), providing a connection feed for messages from AMQP sources.  This package is heavily based on the OpenWhisk Alarms package and is designed to run along side it or deployed separately.  It requires an already existing CouchDB service to provide persistence.

Each [trigger](https://github.com/openwhisk/openwhisk/blob/master/docs/triggers_rules.md) that uses the AMQP feed service is assigned a dedicated [rhea Receiver](https://github.com/grs/rhea#receiver) for message flow and delivery.  Messages are accepted once they have been successfully forwarded to the trigger.  OpenWhisk then distributes the message to any [actions](https://github.com/openwhisk/openwhisk/blob/master/docs/actions.md) activated by the trigger.

## Deployment

This package has two parts: the AMQP feed service and associated OpenWhisk feed actions which control the lifecycle of individual feeds.  The former is a Node.js application that can be run in a docker image.  The latter two are an OpenWhisk Action and related OpenWhisk Web Action that provide the necessary OpenWhisk API requirements for managing the connection feed in a secure manner.

Currently, this package has only been tested within an OpenWhisk instance running on OpenShift.  In the case that you have installed OpenWhisk using https://github.com/projectodd/openwhisk-openshift, you can run a (non-scaling) version of the feed provider by executing the script: deploy/ocWhiskSystem.sh.

With slight modification it should be possible to deploy the AMQP connection feed to Kubernetes or to any arbitrary docker runtime.  Installing by hand requires obtaining the necessary OpenWhisk secrets required by the [Alarms package installer](https://github.com/apache/incubator-openwhisk-package-alarms/blob/master/installCatalog.sh) and running the commands while changing the named "alarm" references for corresponding 'amqp' named entities.

### Deploy the AMQP connection feed on OpenShift

To build the feed, copy this repository to a subdirectory, e.g. "amqpprovider".

```
$ docker build --tag projectodd/amqpprovider:openshift-latest amqpprovider
$ docker run -e ROUTER_HOST=openwhisk-myproject.192.168.42.216.nip.io -e DB_USERNAME=the_name -e DB_HOST=172.30.93.156:5984 -e DB_PASSWORD=the_pw -e DB_PROTOCOL=http -e DB_PREFIX=whisk_amqp_ -p 3002:8080 -it projectodd/amqpprovider:openshift-latest node /amqpTrigger/app.js
```
Where the environment variables are identical to those used by the Alarms package and the port (3002) is unique in your environment.

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

Multiple Receivers to the same AMQP host will share a connection if the connection options are identical and the trigger is created from the same OpenWhisk namespace by the same OpenWhisk user.  Setting a "feed_tag" property on the rhea_options can restrict this connection sharing only to other Receivers with the same feed_tag string value.

## Advanced usage

TODO: Note low level API use to configure the feed/rules/triggers and how to avoid message loss on setup.

## Enhancements coming real soon now

 - easy deployment to OpenShift/Kubernetes/Docker
 - self test
 - provide a mechanism for request/response round-trip using the AMQP feed provider
 - add an UPDATE feed lifecycle event for dynamic credit, or maybe PAUSE/UNPAUSE