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

class AmqpFeed {
    constructor(amqpContainer, logger0) {
        this.container = amqpContainer;
        this.logger = logger0;
        this.connections = new Map();
        this.triggers = new Map();
    }

    connectionID(triggerHandle, key) {
        // for logger
        const wskUser = triggerHandle.apikey.split(':')[0];
        const opts = triggerHandle.rhea_options;
        const host = opts.host || 'localhost';
        const port = opts.port || 'default';
        var id = triggerHandle.namespace + ':' + wskUser + ':' + host + ':' + port;
        if (triggerHandle.feed_tag) { id += '-' + triggerHandle.feed_tag; }
        // TODO: add some minor distinguishing hash of the full key.  Perfect uniqueness not a requirement.
        return id;
    }

    makeKey(triggerHandle) {
        // To identify shareable connections: same owner/auth, same connection properties
        const opts = triggerHandle.rhea_options;
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
    }

    getConnection(triggerHandle) {
        const key = this.makeKey(triggerHandle);
        if (!this.connections.has(key)) {
            this.connect(triggerHandle, key);
        }

        return this.connections.get(key);
    }

    connect(triggerHandle, key) {
        const conn = this.container.connect(triggerHandle.rhea_options);
        conn.feedConnectionKey = key;
        conn.feedConnectionID = this.connectionID(triggerHandle, key);
        this.connections.set(key, conn);

        var events = ['connection_open', 'connection_close', 'disconnected'];
        events.forEach(event => {
            conn.on(event, (context) => {
                this.logger.info('AmqpFeed.connect', event, context.connection.feedConnectionID);
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
    }

    onMessage(context) {
        const message = context.message;
        const rcv = context.receiver;
        const delivery = context.delivery;;
        const feed = this;
        if ('feedTriggerID' in rcv) {
            const trig = feed.triggers.get(rcv.feedTriggerID);
            trig.onMessageCallback(rcv.feedTriggerID, trig, context).then( (message) => {
                delivery.accept();
            })
            .catch( (message, err) => {
                delivery.reject({condition:'amqpfeed:openwhisk:triggerfailure',description:err});
                feed.deleteReceiver(rcv.feedTriggerID);
            });
        }
        else {
            delivery.reject({condition:'amqpfeed:openwhisk:triggercanceled',description:'No OpenWhisk consumer'});
        }
    }

    onReceiverOpen(context) {
        const rcv = context.receiver;

        if (rcv.hasOwnProperty('feedCreationPromise')) {
            rcv.feedCreationPromise.resolve();
            delete rcv.feedCreationPromise;
        }
        else { this.logger.error('onReceiverOpen', 'No handler for receiver'); }
    }
      
    onReceiverError(context) {
        console.log('receiver error:TODO');
    }

    createReceiver(triggerIdentifier, triggerHandle, callback) {
        if (this.triggers.has(triggerIdentifier)) {
            this.deleteReceiver(triggerIdentifier);
        }
        triggerHandle.onMessageCallback = callback;
        const address = triggerHandle.address;
        const onOpen = this.onReceiverOpen;
        const onError = this.onReceiverError;
        const feed = this;

        return new Promise(function(resolve, reject) {
            try {
                const connection = feed.getConnection(triggerHandle);
                const receiver = connection.open_receiver(address);
                // receiver and trigger are 1-1
                feed.triggers.set(triggerIdentifier, triggerHandle);
                receiver.feedTriggerID = triggerIdentifier;
                triggerHandle.feedReceiver = receiver;
                // resolve/reject on future AMQP event
                receiver.feedCreationPromise = {resolve: resolve, reject: reject};
                receiver.on('receiver_open', onOpen);
                receiver.on('receiver_error', onError);
            }
            catch (e) {
                feed.logger.error(method, 'Exception in createTrigger', triggerIdentifier, e);
                reject(e);
            }
        });
    }

    maybeClose(connection) {
        if (this.connections.get(connection.feedConnectionKey) === connection) {
            if (connection.find_receiver( (recv) => { return ('feedTriggerID' in recv); }) ) {
                return;  // at least one valid trigger remains
            }
            connection.close();
            this.connections.delete(connection.feedConnectionKey);
            this.logger.info('closed connection', connection.feedConnectionKey);
        }
    }
                

    deleteReceiver(triggerIdentifier) {
        var method = 'deleteReceiver';
        // called by createTrigger, so state must be clean on return regardless 
        // of future events or promise fulfillment
        if (this.triggers.has(triggerIdentifier)) {
            const trig = this.triggers.get(triggerIdentifier);
            this.triggers.delete(triggerIdentifier);
            const conn = trig.feedReceiver.connection;
            trig.feedReceiver.close();
            delete trig.feedReceiver.feedTriggerID;
            delete trig.feedReceiver;
            this.logger.info(method, 'Deleted', triggerIdentifier);
            this.maybeClose(conn);  // do this after feedTriggerID has been removed
        }
        else { this.logger.info(method, 'delete ignored (duplicate)', triggerIdentifier); }
    }
}

module.exports = AmqpFeed
