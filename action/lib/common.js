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

const request = require('request');

function requestHelper(url, input, method) {

    return new Promise(function(resolve, reject) {

        var options = {
            method : method,
            url : url,
            json: true,
            rejectUnauthorized: false
        };

        if (method === 'get') {
            options.qs = input;
        } else {
            options.body = input;
        }


        request(options, function(error, response, body) {

            if (!error && response.statusCode === 200) {
                resolve(body);
            }
            else {
                if (response) {
                    console.log('amqp feed: Error invoking whisk action:', response.statusCode, body);
                    reject(body);
                }
                else {
                    console.log('amqp feed: Error invoking whisk action:', error);
                    reject(error);
                }
            }
        });
  });
}

function createWebParams(rawParams) {
    var namespace = process.env.__OW_NAMESPACE;
    var name = parseQName(rawParams.triggerName).name;
    var triggerName = '/' + namespace + '/' + name;

    var webparams = Object.assign({}, rawParams);
    delete webparams.lifecycleEvent;
    delete webparams.provider_endpoint;

    webparams.triggerName = triggerName;
    webparams.name = name;
    webparams.namespace = namespace;
    // Next line works based on how apikey is used later in the feed.
    // But why property name change?  Historical?
    webparams.apikey = webparams.authKey;
    return webparams;
}

function parseQName(qname) {
    var parsed = {};
    var delimiter = '/';
    var defaultNamespace = '_';
    if (qname && qname.charAt(0) === delimiter) {
        var parts = qname.split(delimiter);
        parsed.namespace = parts[1];
        parsed.name = parts.length > 2 ? parts.slice(2).join(delimiter) : '';
    } else {
        parsed.namespace = defaultNamespace;
        parsed.name = qname;
    }
    return parsed;
}

function sendError(statusCode, error, message) {
    var params = {error: error};
    if (message) {
        params.message = message;
    }

    return {
        statusCode: statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: new Buffer(JSON.stringify(params)).toString('base64')
    };
}


module.exports = {
    'requestHelper': requestHelper,
    'createWebParams': createWebParams,
    'parseQName': parseQName,
    'sendError': sendError
};
