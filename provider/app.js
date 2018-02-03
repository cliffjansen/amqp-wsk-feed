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
/**
 * OpenWhisk provider service (AKA: "connection feed") for AMQP messages.
 */

var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var logger = require('./Logger');

const amqpContainer = require('rhea');
const AmqpFeed = require('./lib/amqpfeed.js');
var ProviderUtils = require('./lib/utils.js');
var ProviderHealth = require('./lib/health.js');
var ProviderRAS = require('./lib/ras.js');
var constants = require('./lib/constants.js');

// Initialize the Express Application
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.set('port', process.env.PORT || 3001);

// Allow invoking servers with self-signed certificates.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';


// Create the Provider Server
var server = http.createServer(app);
server.listen(app.get('port'), function() {
    logger.info('server.listen', 'Express server listening on port ' + app.get('port'));
});


// Initialize the Provider Server
function init(server) {
    var method = 'init';
    var nanoDb;
    var providerUtils;

    if (server !== null) {
        var address = server.address();
        if (address === null) {
            logger.error(method, 'Error initializing server. Perhaps port is already in use.');
            process.exit(-1);
        }
    }

    // TODO: persistence of trigger data?

    try {
        var amqpFeed = new AmqpFeed(amqpContainer, logger);
        var providerUtils = new ProviderUtils(amqpFeed, logger);
        var providerRAS = new ProviderRAS();
        var providerHealth = new ProviderHealth(providerUtils, amqpFeed);

        // RAS Endpoint
        app.get(providerRAS.endPoint, providerRAS.ras);

        // Health Endpoint
        app.get(providerHealth.endPoint, providerUtils.authorize, providerHealth.health);

// TODO        providerUtils.initAllTriggers();

        app.post('/amqp', providerUtils.createTrigger);
        app.delete('/amqp', providerUtils.deleteTrigger);
    }
    catch(err) {
        console.error(err);
        logger.error(method, 'initialization error:', err);
    }

}

init(server);

console.log('AMQP Provider Service init complete');
