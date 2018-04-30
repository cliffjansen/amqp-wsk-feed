/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */

'use strict';

module.exports = function(amqpContainer, logger) {
    this.container = amqpContainer;
    this.logger = logger;
    this.connections = new Map();
    this.triggers = new Map();  // TODO: reuse utils.triggers... which is not a map

    this.connectionID = function(triggerHandle, key) {
        // for logger
        const wskUser = triggerHandle.apikey.split(':')[0];
        const opts = triggerHandle.connection_options;
        const host = opts.host || 'localhost';
        const port = opts.port || 'default';
        var id = triggerHandle.namespace + ':' + wskUser + ':' + host + ':' + port;
        if (triggerHandle.feed_tag) { id += '-' + triggerHandle.feed_tag; }
        // TODO: add some minor distinguishing hash of the full key.  Perfect uniqueness not a requirement.
        return id;
    };

    this.makeKey = function(triggerHandle) {
        // To identify shareable connections: same owner/auth, same connection properties
        const opts = triggerHandle.connection_options;
        const host = opts.host || 'localhost';        
        var key = triggerHandle.namespace + ':' + triggerHandle.apikey + '-';
        if (triggerHandle.feed_tag) { key += '<' + triggerHandle.feed_tag + '>'; }
        key += host;

        const optNames = ['port', 'username', 'password', 'reconnect', 'reconnect_limit', 'initial_reconnect_delay', 'max_reconnect_delay', 'tcp_no_delay', 'sasl_mechanisms', 'enable_sasl_external', 'require_sasl', 'disable_sasl', 'non_fatal_errors'];
        optNames.forEach(name => {
            if (opts[name] === undefined) {
                key += '.';
            } else { key += ':' + opts[name]; }
        });
        if (opts.transport === 'tls' || opts.transport === 'ssl') {
            key += '-TLS';
            const optNames2 = ['ca', 'cert', 'rejectUnauthorized', 'servername'];
            optNames2.forEach(name => {
                if (opts[name] === undefined) {
                    key += '.';
                } else {key += ':' + name;}
            });
        }
        return key;
    };

    this.getConnection = function(triggerHandle) {
        var method = 'getConnection';
        const key = this.makeKey(triggerHandle);
        if (!this.connections.has(key)) {
            this.connect(triggerHandle, key);
        }

        return this.connections.get(key);
    };

    this.connect = function(triggerHandle, key) {
        var method = 'connect';
        const conn = this.container.connect(triggerHandle.connection_options);
        conn.feedConnectCount = 0;
        conn.feedConnectionKey = key;
        conn.feedConnectionID = this.connectionID(triggerHandle, key);
        this.connections.set(key, conn);

        var events = ['connection_open', 'connection_close', 'disconnected'];
        events.forEach(event => {
            conn.on(event, (context) => {
                this.logger.info('AmqpFeed.connect', event, context.connection.feedConnectionID);
                if (event == 'connection_open') {
                    context.connection.feedConnectCount++;
                }
                else if (event == 'connection_close') {
                    this.onConnectionClose(context);
                }
                else if (event == 'disconnected') {
                    var conn = context.connection;
                    if (!conn.feedConnectCount) {
                        conn.close();  // Only reconnect if we ever succeeded.  Make configurable?
                        if (conn.hasOwnProperty('feedSocketError') || conn.get_error()) {
                            this.failedConnect(conn);
                        } else {
                            process.nextTick(this.failedConnect.bind(this, conn));  // Might see socket error by then
                        }
                    }
                }
            });
        });

        events = ['connection_error', 'protocol_error'];
        events.forEach(event => {
            conn.on(event, (context) => {
                this.logger.info('AmqpFeed.connect', event, context.connection.error, context.connection.feedConnectionID);
            });
        });

        conn.on('message', (context) => {
            this.onMessage(context);
        })

        conn.socket.on('error', this.onConnectionError.bind(conn));
    };

    this.onMessage = function(context) {
        var method = 'onMessage';
        var message = context.message;
        var rcv = context.receiver;
        var triggerIdentifier = rcv.feedTriggerID;
        var delivery = context.delivery;;
        var feed = this;
        if (rcv.feedLinkClosing) {
            // Normal occurence in async protocol
            this.logger.info(method, 'message rejected (async close)', triggerIdentifier);
            delivery.reject({condition:'amqpfeed:openwhisk:triggerclosed',description:'async close in progress'});
            return;
        }
        if (feed.triggers.has(triggerIdentifier)) {
            var trigger = feed.triggers.get(rcv.feedTriggerID);
            trigger.payload = {type: 'message', body: message.body};
            trigger.amqpDelivery = context.delivery;  // utils code does eventual accept/reject
            trigger.fireCallback();
            trigger.amqpDelivery = null;
        }
        else {
            this.logger.info(method, 'internal trigger state error', triggerIdentifier);
            delivery.reject({condition:'amqpfeed:openwhisk:triggercanceled',description:'No OpenWhisk consumer'});
        }
    };

    this.onReceiverOpen = function(context) {
        var method = 'onReceiverOpen';
        var rcv = context.receiver;

        if (!rcv.feedLinkError) {
            rcv.feedLinkOpened = true;
        }
    };
      
    this.onReceiverError = function(context) {
        var rcv = context.receiver;
        this.doReceiverError(rcv, rcv.remote.detach.error);
    }

    this.doReceiverError = function(rcv, errmsg) {
        var method = 'doReceiveError';
        if (rcv.feedLinkClosing) {
            return;
        }

        if (!this.triggers.has(rcv.feedTriggerID)) {
            this.logger.error(method, 'untracked link', rcv.feedTriggerID);
            return;
        }

        var trigger = this.triggers.get(rcv.feedTriggerID);
        trigger.payload = {type: 'feed_error', error: errmsg};
        trigger.fireCallback();

        this.providerUtils.disableTrigger(trigger.triggerID, undefined, errmsg);
    };

    this.onConnectionError = function(err) {
        var conn = this;  // via bind
        if (!conn.hasOwnProperty('feedSocketError')) {
            conn.feedSocketError = err;
        }
    }

    this.failedConnect = function(conn) {
        var method = 'failedConnect';
        var err;
        console.log('in failed connect');
        if (conn.hasOwnProperty('feedSocketError')) {
            err = conn.feedSocketError;
        } else {
            err = conn.get_error() || 'unknown error';
        }
        this.logger.info(method, 'disconnected', err.message);
        
        conn.each_link( (recv) => {
            this.doReceiverError(recv, 'disconnected: ' + err);
        });
    }

    this.onConnectionClose = function(context) {
        var method = 'onConnectionClose';
        var conn = context.connection;
        if (!conn.feedConnectionCount || !conn.local.close) {
            var err = context.connection.get_error();
            this.logger.info(method, 'Connection disconnected', err);
            // TODO: for each receiver send conn close event + error to trigger
            // + disable?
        }
    };

    this.createFeed = function(newTrigger, callback) {

        // newTrigger is the couchdb change doc.  
        var cachedTrigger = {
            apikey: newTrigger.apikey,
            name: newTrigger.name,
            namespace: newTrigger.namespace,
            triggerID: newTrigger.triggerID,
            uri: newTrigger.uri,
            maxTriggers: newTrigger.maxTriggers,
            monitor: newTrigger.monitor,
            address: newTrigger.address,
            connection_options: newTrigger.connection_options
        };

        var method = 'createFeed';
        var triggerIdentifier = newTrigger.triggerID;
        if (this.triggers.has(triggerIdentifier)) {
            this.deleteReceiver(triggerIdentifier);
        }
        cachedTrigger.fireCallback = callback;
        const address = cachedTrigger.address;
        const onOpen = this.onReceiverOpen;
        const onError = this.onReceiverError;
        const feed = this;

        try {
            cachedTrigger.payload = null;
            cachedTrigger.amqpDelivery = null;
            const connection = feed.getConnection(cachedTrigger);
            const receiver = connection.open_receiver(address);
            // receiver and trigger are 1-1
            feed.triggers.set(triggerIdentifier, cachedTrigger);
            receiver.feedTriggerID = triggerIdentifier;
            cachedTrigger.feedReceiver = receiver;
            receiver.on('receiver_open', onOpen);
            receiver.on('receiver_error', onError);
            receiver.feedLinkError = false;
            receiver.feedLinkOpened = false;
            receiver.feedLinkClosing = false;
        }
        catch (e) {
            feed.logger.error(method, 'Exception in createTrigger', triggerIdentifier, e);
            return Promise.reject(e);
        }
        return Promise.resolve(cachedTrigger);
    };

    this.maybeClose = function(connection) {
        if (this.connections.get(connection.feedConnectionKey) === connection) {
            if (connection.find_receiver( (recv) => { return ('feedTriggerID' in recv); }) ) {
                return;  // at least one valid trigger remains
            }
            connection.close();
            this.connections.delete(connection.feedConnectionKey);
            this.logger.info('closed connection', connection.feedConnectionKey);
        }
    };
                

    this.deleteReceiver = function(triggerIdentifier) {
        var method = 'deleteReceiver';
        // called by createTrigger, so state must be clean on return regardless 
        // of future events or promise fulfillment
        if (this.triggers.has(triggerIdentifier)) {
            const trig = this.triggers.get(triggerIdentifier);
            this.triggers.delete(triggerIdentifier);
            const conn = trig.feedReceiver.connection;
            trig.feedReceiver.close();
            trig.feedReceiver.feedLinkClosing = true;  // reject async inbound messages
            delete trig.feedReceiver.feedTriggerID;
            delete trig.feedReceiver;
            this.logger.info(method, 'Deleted', triggerIdentifier);
            this.maybeClose(conn);  // do this after feedTriggerID has been removed
        }
        else { this.logger.info(method, 'delete ignored (duplicate)', triggerIdentifier); }
    };

};
