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

var request = require('request');
var HttpStatus = require('http-status-codes');
var constants = require('./constants.js');

module.exports = function(
  amqpFeed,
  logger
) {
    this.module = 'utils';
    this.endpointAuth = process.env.ENDPOINT_AUTH;
    this.routerHost = process.env.ROUTER_HOST || 'localhost';

    var retryDelay = constants.RETRY_DELAY;
    var retryAttempts = constants.RETRY_ATTEMPTS;
    var utils = this;

    this.createTrigger = function(req, res) {
        var method = 'createTrigger';

        var dataTrigger = {
            apikey: req.body.apikey,
            name: req.body.name,
            namespace: req.body.namespace,
            feed_tag: req.body.feed_tag,
            // AMQP bits
            url: req.body.url,
            address: req.body.address,
            credit: req.body.credit,
            rhea_options: req.body.rhea_options
        };
        var triggerIdentifier = utils.getTriggerIdentifier(dataTrigger.apikey, dataTrigger.namespace, dataTrigger.name);

        var callback = function onMessage(id, handle, context) {
            var triggerID = id;
            var triggerHandle = handle;
            try {
                return utils.fireTrigger(triggerHandle, context);
            } catch (e) {
                logger.error(method, 'Exception occurred while firing trigger', triggerID, e);
                return Promise.reject('Internal error');
            }
            return Promise.reject('Target trigger deleted: ' + triggerIdentifier);
        };

        amqpFeed.createReceiver(triggerIdentifier, dataTrigger, callback).then (
            function () {
                res.send();
            })
        .catch( (err) => {
            res.status(500).json({ error: err})
        });
    };

    this.deleteTrigger = function(req, res) {
        var method = 'deleteTrigger';

        var dataTrigger = {
            apikey: req.body.apikey,
            name: req.body.name,
            namespace: req.body.namespace,
        };
        var triggerIdentifier = utils.getTriggerIdentifier(dataTrigger.apikey, dataTrigger.namespace, dataTrigger.name);
        amqpFeed.deleteReceiver(triggerIdentifier);  // deletes if exists, does nothing otherwise
        res.send();
    };

    this.getTriggerIdentifier = function(apikey, namespace, name) {
        return apikey + '/' + namespace + '/' + name;
    };

    this.authorize = function(req, res, next) {
        var method = 'authorize';

        if (utils.endpointAuth) {

            if (!req.headers.authorization) {
                res.set('www-authenticate', 'Basic realm="Private"');
                res.status(HttpStatus.UNAUTHORIZED);
                return res.send('');
            }

            var parts = req.headers.authorization.split(' ');
            if (parts[0].toLowerCase() !== 'basic' || !parts[1]) {
                return utils.sendError(method, HttpStatus.BAD_REQUEST, 'Malformed request, basic authentication expected', res);
            }

            var auth = new Buffer(parts[1], 'base64').toString();
            auth = auth.match(/^([^:]*):(.*)$/);
            if (!auth) {
                return utils.sendError(method, HttpStatus.BAD_REQUEST, 'Malformed request, authentication invalid', res);
            }

            var uuid = auth[1];
            var key = auth[2];

            var endpointAuth = utils.endpointAuth.split(':');

            if (endpointAuth[0] === uuid && endpointAuth[1] === key) {
                next();
            }
            else {
                logger.warn(method, 'Invalid key');
                return utils.sendError(method, HttpStatus.UNAUTHORIZED, 'Invalid key', res);
            }
        }
        else {
            next();
        }
    };

    this.sendError = function(method, code, message, res) {
        logger.error(method, message);
        res.status(code).json({error: message});
    };

    this.fireTrigger = function(dataTrigger, context) {
        var method = 'fireTrigger';

        var triggerIdentifier = utils.getTriggerIdentifier(dataTrigger.apikey, dataTrigger.namespace, dataTrigger.name);
        var host = 'https://' + utils.routerHost + ':443';
        var auth = dataTrigger.apikey.split(':');
        var uri = host + '/api/v1/namespaces/' + dataTrigger.namespace + '/triggers/' + dataTrigger.name;

        logger.info(method, 'trigger fired for', triggerIdentifier, 'attempting to fire trigger');
        return utils.postTrigger(dataTrigger, uri, auth, 0, context);
    };

    this.postTrigger = function(dataTrigger, uri, auth, retryCount, context) {
        var method = 'postTrigger';

        return new Promise(function(resolve, reject) {

            // only manage trigger fires if they are not infinite
            if (dataTrigger.maxTriggers && dataTrigger.maxTriggers !== -1) {
                dataTrigger.triggersLeft--;
            }

            request({
                method: 'post',
                uri: uri,
                auth: {
                    user: auth[0],
                    pass: auth[1]
                },
                json: {
                    body: context.message.body
                }
            }, function(error, response) {
                try {
                    var triggerIdentifier = utils.getTriggerIdentifier(dataTrigger.apikey, dataTrigger.namespace, dataTrigger.name);
                    logger.info(method, triggerIdentifier, 'http post request, STATUS:', response ? response.statusCode : response);

                    if (error || response.statusCode >= 400) {
                        // only manage trigger fires if they are not infinite
                        if (dataTrigger.maxTriggers && dataTrigger.maxTriggers !== -1) {
                            dataTrigger.triggersLeft++;
                        }
                        logger.error(method, 'there was an error invoking', triggerIdentifier, response ? response.statusCode : error);
                        // TODO: what if HttpStatus.REQUEST_TIMEOUT, HttpStatus.TOO_MANY_REQUESTS ?
                        if (error || !utils.shouldDisableTrigger(response.statusCode)) {
                            if (retryCount < retryAttempts) {
                                logger.info(method, 'attempting to fire trigger again', triggerIdentifier, 'Retry Count:', (retryCount + 1));
                                setTimeout(function () {
                                    utils.postTrigger(dataTrigger, uri, auth, (retryCount + 1))
                                    .then(triggerId => {
                                        resolve(triggerId);
                                    })
                                    .catch(err => {
                                        reject(err);
                                    });
                                }, retryDelay);
                            } else {
                                reject('Unable to reach server to fire trigger ' + triggerIdentifier);
                            }
                        }
                    } else {
                        logger.info(method, 'fired', triggerIdentifier);
                        resolve(triggerIdentifier);
                    }
                }
                catch(err) {
                    reject('Exception occurred while firing trigger ' + err);
                }
            });
        });
    };

};
