# amqp-wsk-feed

An [AMQP](https://www.amqp.org/) package for [OpenWhisk](https://github.com/openwhisk/openwhisk), providing a connection feed for messages from AMQP sources.

Each [trigger](https://github.com/openwhisk/openwhisk/blob/master/docs/triggers_rules.md) that uses the AMQP feed is assigned a dedicated [rhea Receiver](https://github.com/grs/rhea#receiver) for message flow and delivery.  Messages are accepted once they have been successfully forwarded to the trigger.  OpenWhisk then distributes the message to any [actions](https://github.com/openwhisk/openwhisk/blob/master/docs/actions.md) activated by the trigger.

## Deployment

This package has two parts: the connection feed and an associated feed action.  The former is a Node.js application that runs in a docker image launched independently from OpenWhisk.  The latter is an OpenWhisk action that provides OpenWhisk API requirements for managing the connection feed.  

It should be noted that a [connection feed](https://github.com/openwhisk/openwhisk/blob/master/docs/feeds.md#implementing-feeds-via-connections) is different from other OpenWhisk feed types in that it runs continuously and is often hosted outside the OpenWhisk runtime.  The OpenWhisk documentation will often refer to a connection feed as a "provider service".  Consequently you will often find the terms "feed" and "provider" used interchangeably in this project's source code to refer to the connection feed.

As you build and deploy you will need to choose a hostname and port for the running feed and obtain the hostname for your OpenWhisk instance.

To build the feed, edit the "EXPOSE" line in the Dockerfile to reflect the port chosen for your feed (3001 used for illustration). Then build the image:

```
$ docker build -t user_name/amqp_feed .
```

The AMQP feed uses environment variables: PORT to find the port to listen on, and ROUTER_HOST to find the OpenWhisk instance (see the output from '''wsk property get --apihost''', 172.17.0.1 is used for illustration).  To run the feed:

```
$ docker run -e PORT=3001 -e ROUTER_HOST=172.17.0.1 -p 3001:3001 user_name/amqp_feed
```

The "feed action" is a Node.js OpenWhisk action.  To build: create a zip file of the contents at and below the "action" directory.  

'''
$ (rm -f /tmp/foo.zip && cd action && zip -qr /tmp/foo.zip *)
'''

To deploy the feed action, create an OpenWhisk package to host the action.  This facilitates sharing the feed action between OpenWhisk namespaces and centralizes the its configuration.  Then create the action from the zip file within the package.  Substitute the appropriate values from the running docker AMQP feed image for the FEED_HOST and FEED_PORT slots in the next commands.

'''
$ wsk package create -p provider_endpoint http://<FEED_HOST>:<FEED_PORT>/amqp amqp
$ wsk action create amqp/amqpfd -a feed true --kind nodejs:6 ../tmp/foo.zip

'''

## Usage

Create your own custom action, trigger and rule.

```js
// msglog.js
function main(params) {
    console.log(params.body);
    return {payload: ''};
}
```

```
$ wsk action create msglog msglog.js
$ wsk trigger create trig_01 --feed amqp/amqpfd -p address queue_99 -p rhea_options '{"host": "broker6.myorg.com", "port": 5672 }'
$ wsk rule create rule_7 trig_01 msglog
```

There will be one invocation of the msglog action for each inbound message processed by the feed.  Several instances of the msglog action may run concurrently.  While the inbound messages from the rhea Receiver are delivered in order to the OpenWhisk trigger, there is no guaranteed order in which they are processed by the related OpenWhisk action.

The rhea_options argument can be any valid rhea connection options.

Multiple Receivers to the same AMQP host will share a connection if the connection options are identical and the the trigger is created from the same OpenWhisk namespace by the same OpenWhisk user.

## Advanced usage

TODO: Note low level API use to configure the feed/rules/triggers and how to avoid message loss on setup.

## Enhancements coming real soon now

 - Persistence.  Receivers should be reconstructed on feed restart.
 - Provide easy to setup TLS security between feed and feed action using script generated certs.
 - self test
 - failover
 - add an UPDATE feed lifecycle event for dynamic credit, or maybe PAUSE/UNPAUSE