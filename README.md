# amqp-wsk-feed

An [AMQP](https://www.amqp.org/) package for [OpenWhisk](https://github.com/openwhisk/openwhisk), providing a connection feed for messages from AMQP sources.

Each [trigger](https://github.com/openwhisk/openwhisk/blob/master/docs/triggers_rules.md) that uses the AMQP feed is assigned a dedicated [rhea Receiver](https://github.com/grs/rhea#receiver) for message flow and delivery.  Messages are accepted once they have been successfully forwarded to the trigger.  OpenWhisk then distributes the message to any [actions](https://github.com/openwhisk/openwhisk/blob/master/docs/actions.md) activated by the trigger.

## Pre-requisites

Its assumed that OpenWhisk is deployed and running on OpenShift.

## Deployment

This package has two parts: the connection feed and an associated feed action.  The former is a Node.js application that runs in a docker image launched independently from OpenWhisk.  The latter is an OpenWhisk action that provides OpenWhisk API requirements for managing the connection feed.  

It should be noted that a [connection feed](https://github.com/openwhisk/openwhisk/blob/master/docs/feeds.md#implementing-feeds-via-connections) is different from other OpenWhisk feed types in that it runs continuously and is often hosted outside the OpenWhisk runtime.  The OpenWhisk documentation will often refer to a connection feed as a "provider service".  Consequently you will often find the terms "feed" and "provider" used interchangeably in this project's source code to refer to the connection feed.

As you build and deploy you will need to choose a hostname and port for the running feed and supply the hostname for your OpenWhisk instance.

### Deploy the AMQP connection feed

#### OpenShift

##### Create Application

```sh
$ cd provider
$ oc new-build --binary --name=amqp-feed -l app=amqp-feed
$ npm install; oc start-build amqp-feed --from-dir=. --follow
$ oc new-app amqp-feed -l app=amqp-feed
$ oc expose service amqp-feed
```

##### Enable Liveliness Readiness Probe

```sh
$ oc set probe dc/amqp-feed --readiness --get-url=http://:8080/health --timeout-seconds=3 --initial-delay-seconds=5
$ oc set probe dc/amqp-feed --liveness  --get-url=http://:8080/health --timeout-seconds=3 --initial-delay-seconds=5
```

##### Set Environment Variables

The Feed Provider needs to know the `OpenWhisk API Host` to perform the triggers, hence we need to set the environment value `ROUTER_HOST`

```sh
API_HOST=$(oc get route/openwhisk --template="{{.spec.host}}" --namespace openwhisk)
oc set env dc/amqp-feed ROUTER_HOST="${API_HOST}"
```

NOTE: 

* Above example assumes that OpenWhisk has been deployed in namespace called `openwhisk`, if you have deployed OpenWhisk in different namespace then alter the `--namespace` url to point to right namespace
* It is also possible to set the in-cluster service name like `ngnix.openwhisk`, but setting this way will help configuring our provider pointing external url of API_HOST, which helps in portability.

### Deploy the feed action

The "feed action" is a Node.js OpenWhisk action.  To build: create a zip file of the contents at and below the "action" directory.  

```sh
$ cd ../action
$ ( rm -f /tmp/foo.zip && zip -qr /tmp/foo.zip * )
```

To deploy the feed action, create an OpenWhisk package to host the action.  This facilitates sharing the feed action between OpenWhisk namespaces and centralizes its configuration.  Then create the action in the package namespace from the zip file.  Substitute the appropriate values from the running docker AMQP feed image for the FEED_HOST and FEED_PORT slots in the next commands.

```
$ FEED_URL=$(oc get route/amqp-feed --template="{{.spec.host}}" --namespace myproject)
$ wsk -i package create -p provider_endpoint http://$FEED_URL/amqp amqp
$ wsk -i action create amqp/amqpfd -a feed true --kind nodejs:6 /tmp/foo.zip
```
NOTE: 

* Above example assumes that Feed Provider has been deployed in namespace called `myproject`, if you have deployed Feed Provider  in different namespace then alter the `--namespace` url to point to right namespace.

## Usage

Create your own custom action, trigger and rule.

```js
// msglog.js
function main(params) {
    console.log('inbound message with body', params.body);
    return {payload: ''};
}
```

```
$ cd ../test
$ wsk -i action create msglog msglog.js
$ wsk -i trigger create trig_01 --feed amqp/amqpfd -p address queue_99 -p rhea_options '{"host": "broker6.myorg.com", "port": 5672 }'
$ wsk -i rule create rule_7 trig_01 msglog
```

There will be one invocation of the msglog action for each inbound message processed by the feed.  Several instances of the msglog action may run concurrently.  While the inbound messages from the rhea Receiver are delivered in order to the OpenWhisk trigger, there is no guaranteed order in which they are processed by the related OpenWhisk action invocations.

In the above example the message passes from the feed => trig_01 => rule_7 => msglog in a simple pipeline fashion.  OpenWhisk allows much more complicated combinations of triggers, rules and actions which could lead to the message being processed by multiple actions in series or in parallel.

The rhea_options argument can be composed of any valid connection options used in rhea.

Multiple Receivers to the same AMQP host will share a connection if the connection options are identical and the trigger is created from the same OpenWhisk namespace by the same OpenWhisk user.  Setting a "feed_tag" property on the rhea_options can restrict this connection sharing only to other Receivers with the same feed_tag string value.

## Advanced usage

TODO: Note low level API use to configure the feed/rules/triggers and how to avoid message loss on setup.

## Enhancements coming real soon now

 - Persistence.  Receivers should be reconstructed on feed restart.
 - Provide easy to setup TLS security between feed and feed action using script generated certs.
 - self test
 - failover
 - add an UPDATE feed lifecycle event for dynamic credit, or maybe PAUSE/UNPAUSE