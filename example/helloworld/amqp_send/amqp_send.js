/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var container = require('rhea');

function amqp_send(params) {
    var total = params.count || 1;
    var node = params.node || 'examples';
    var host = params.host || 'localhost';
    var port = params.port || 5672;
    var msgbody = params.body || 'Hello World';
    var user = params.user || '';
    var pass = params.pass || '';

    return new Promise(function(resolve, reject) {

        var confirmed = 0, sent = 0;
        var conn = container.connect({port: port, host: host, username: user, password: pass});
        conn.open_sender(node);

        conn.on('sendable', function (context) {
            while (context.sender.sendable() && sent < total) {
                sent++;
                console.log('sent ' + sent);
                context.sender.send({message_id:sent, body:msgbody})
            }
        });
        conn.on('accepted', function (context) {
            if (++confirmed === total) {
                console.log('all messages confirmed');
                context.connection.close();
                resolve({transfers: confirmed});
            }
        });
        conn.on('disconnected', function (context) {
            if (confirmed != total) {
                var err = context.error || context.connection.get_error();
                console.log(total - confirmed, 'messages not transferred.', err);
                reject(err);
            }
        });
        conn.on('protocol_error', function (err) {
            if (confirmed != total) {
                console.log(total - confirmed, 'messages not transferred.', err.message);
                reject(err.message);
            }
        });
    });
}




exports.main = amqp_send;
