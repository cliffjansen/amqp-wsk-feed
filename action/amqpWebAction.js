var moment = require('moment');

const common = require('./lib/common');
const Database = require('./lib/Database');

function main(params) {
    if (!params.authKey) {
        return common.sendError(400, 'no authKey parameter was provided');
    }
    if (!params.triggerName) {
        return common.sendError(400, 'no trigger name parameter was provided');
    }

    var triggerParts = common.parseQName(params.triggerName);
    var triggerID = `${params.authKey}/${triggerParts.namespace}/${triggerParts.name}`;
    var triggerURL = `https://${params.apihost}/api/v1/namespaces/${triggerParts.namespace}/triggers/${triggerParts.name}`;

    var workers = params.workers instanceof Array ? params.workers : [];
    var db;

    if (params.__ow_method === "post") {

        var newTrigger = {
            apikey: params.authKey,
            name: triggerParts.name,
            namespace: triggerParts.namespace,
            payload: params.trigger_payload || {},
            status: {
                'active': true,
                'dateChanged': Date.now()
            }
        };

        // TODO: basic sanity checks of next three
        var credit = 10;
        if (!params.address) {
            return common.sendError(400, 'AMQP address parameter missing');
        }
        if (!params.connection) {
            return common.sendError(400, 'AMQP connection parameter missing');
        }
        if (params.credit) {
            credit = params.credit;
        }

        newTrigger.address = params.address;
        newTrigger.connection = params.connection;
        newTrigger.credit = credit;
        newTrigger.maxTriggers = -1;  // TODO: deprecated, remove after fixing use in trigger views/filters

        return new Promise(function (resolve, reject) {
            common.verifyTriggerAuth(triggerURL, params.authKey, false)
            .then(() => {
                db = new Database(params.DB_URL, params.DB_NAME);
                return db.getWorkerID(workers);
            })
            .then((worker) => {
                console.log('trigger will be assigned to worker ' + worker);
                newTrigger.worker = worker;
                return db.createTrigger(triggerID, newTrigger);
            })
            .then(() => {
                resolve({
                    statusCode: 200,
                    headers: {'Content-Type': 'application/json'},
                    body: new Buffer(JSON.stringify({'status': 'success'})).toString('base64')
                });
            })
            .catch(err => {
                reject(err);
            });
        });

    }
    else if (params.__ow_method === "get") {
        return new Promise(function (resolve, reject) {
            common.verifyTriggerAuth(triggerURL, params.authKey, false)
            .then(() => {
                db = new Database(params.DB_URL, params.DB_NAME);
                return db.getTrigger(triggerID);
            })
            .then(doc => {
                var body = {
                    config: {
                        name: doc.name,
                        namespace: doc.namespace,
                        payload: doc.payload
                    },
                    status: {
                        active: doc.status.active,
                        dateChanged: moment(doc.status.dateChanged).utc().valueOf(),
                        dateChangedISO: moment(doc.status.dateChanged).utc().format(),
                        reason: doc.status.reason
                    }
                };
                body.config.address = doc.address;
                body.config.credit = doc.credit;
                resolve({
                    statusCode: 200,
                    headers: {'Content-Type': 'application/json'},
                    body: new Buffer(JSON.stringify(body)).toString('base64')
                });
            })
            .catch(err => {
                reject(err);
            });
        });
    }
    else if (params.__ow_method === "put") {

        return new Promise(function (resolve, reject) {
            var updatedParams = {};

            common.verifyTriggerAuth(triggerURL, params.authKey, false)
            .then(() => {
                db = new Database(params.DB_URL, params.DB_NAME);
                return db.getTrigger(triggerID);
            })
            .then(trigger => {
                if (trigger.status && trigger.status.reason && trigger.status.reason.kind === 'ADMIN') {
                    return reject(common.sendError(400, `${params.triggerName} cannot be updated because it was disabled by an admin.  Please contact support for further assistance`));
                }

                if (params.credit) {
                    updatedParams.credit = params.credit;
                }
                if (params.address) {
                    return reject(common.sendError(400, 'AMQP address cannot be changed on update.'));
                }
                if (params.connection) {
                    return reject(common.sendError(400, 'AMQP connection parameters cannot be changed on update.'));
                }
                if (Object.keys(updatedParams).length === 0) {
                    return reject(common.sendError(400, 'no updatable parameters were specified'));
                }
                return db.disableTrigger(trigger._id, trigger, 0, 'updating');
            })
            .then(triggerID => {
                return db.getTrigger(triggerID);
            })
            .then(trigger => {
                return db.updateTrigger(trigger._id, trigger, updatedParams, 0);
            })
            .then(() => {
                resolve({
                    statusCode: 200,
                    headers: {'Content-Type': 'application/json'},
                    body: new Buffer(JSON.stringify({'status': 'success'})).toString('base64')
                });
            })
            .catch(err => {
                reject(err);
            });
        });
    }
    else if (params.__ow_method === "delete") {

        return new Promise(function (resolve, reject) {
            common.verifyTriggerAuth(triggerURL, params.authKey, true)
            .then(() => {
                db = new Database(params.DB_URL, params.DB_NAME);
                return db.getTrigger(triggerID);
            })
            .then(trigger => {
                return db.disableTrigger(trigger._id, trigger, 0, 'deleting');
            })
            .then(triggerID => {
                return db.deleteTrigger(triggerID, 0);
            })
            .then(() => {
                resolve({
                    statusCode: 200,
                    headers: {'Content-Type': 'application/json'},
                    body: new Buffer(JSON.stringify({'status': 'success'})).toString('base64')
                });
            })
            .catch(err => {
                reject(err);
            });
        });
    }
    else {
        return common.sendError(400, 'unsupported lifecycleEvent');
    }
}

exports.main = main;


