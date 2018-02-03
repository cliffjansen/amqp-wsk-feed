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

var si = require('systeminformation');
var v8 = require('v8');

module.exports = function(utils, amqpFeed) {

    // Health Endpoint
    this.endPoint = '/health';

    // Health Logic
    this.health = function (req, res) {

        var stats = {triggers: amqpFeed.triggers.size};
        stats.connections = amqpFeed.connections.size;

        // get all system stats in parallel
        Promise.all([
            si.mem(),
            si.currentLoad(),
            si.fsSize(),
            si.networkStats(),
            si.inetLatency(utils.routerHost)
        ])
        .then(results => {
            stats.memory = results[0];
            stats.cpu = results[1];
            stats.disk = results[2];
            stats.network = results[3];
            stats.apiHostLatency = results[4];
            stats.heapStatistics = v8.getHeapStatistics();
            stats.heapSpaceStatistics =v8.getHeapSpaceStatistics();
            res.send(stats);
        })
        .catch(error => {
            stats.error = error;
            res.send(stats);
        });
    };

};
