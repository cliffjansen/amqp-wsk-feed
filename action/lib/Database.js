const common = require('./common');

// constructor for DB object - a thin, promise-loving wrapper around nano
module.exports = function(dbURL, dbName) {
    var nano = require('nano')(dbURL);
    this.db = nano.db.use(dbName);
    var utilsDB = this;
    console.log('ZZZ DB setup ', dbURL, dbName);

    this.getWorkerID = function(availabeWorkers) {

        return new Promise((resolve, reject) => {
            var workerID = availabeWorkers[0] || 'worker0';

    console.log('ZZZ DB maybe view ', availabeWorkers.length);

            if (availabeWorkers.length > 1) {
                utilsDB.db.view('triggerViews', 'triggers_by_worker', {reduce: true, group: true}, function (err, body) {
                    if (!err) {
                        var triggersByWorker = {};

                        availabeWorkers.forEach(worker => {
                            triggersByWorker[worker] = 0;
                        });

                        body.rows.forEach(row => {
                            if (row.key in triggersByWorker) {
                                triggersByWorker[row.key] = row.value;
                            }
                        });

                        // find which worker has the least number of assigned triggers
                        for (var worker in triggersByWorker) {
                            if (triggersByWorker[worker] < triggersByWorker[workerID]) {
                                workerID = worker;
                            }
                        }
                        resolve(workerID);
                    } else {
                        reject(err);
                    }
                });
            }
            else {
                resolve(workerID);
            }
        });
    };

    this.createTrigger = function(triggerID, newTrigger) {

        return new Promise(function(resolve, reject) {

    console.log('ZZZ DB insert trigger ', newTrigger, triggerID);

            utilsDB.db.insert(newTrigger, triggerID, function (err) {
                if (!err) {
    console.log('ZZZ DB insert trigger wins ');
                    resolve();
                }
                else {
    console.log('ZZZ DB insert trigger fails ');
                    reject(common.sendError(err.statusCode, 'error creating AMQP trigger.', err.message));
                }
            });
        });
    };

    this.getTrigger = function(triggerID, retry = true) {

        return new Promise(function(resolve, reject) {

            var qName = triggerID.split('/');
            var id = retry ? triggerID : qName[0] + '/_/' + qName[2];
    console.log('ZZZ DB get ', triggerID, id);
            utilsDB.db.get(id, function (err, existing) {
                if (err) {
                    if (retry) {
                        utilsDB.getTrigger(triggerID, false)
                        .then(doc => {
                            resolve(doc);
                        })
                        .catch(err => {
                            reject(err);
                        });
                    } else {
                        var name = '/' + qName[1] + '/' + qName[2];
                        reject(common.sendError(err.statusCode, 'could not find trigger ' + name + ' in the database'));
                    }
                } else {
    console.log('ZZZ DB get found', existing);
                    resolve(existing);
                }
            });
        });
    };

    this.disableTrigger = function(triggerID, trigger, retryCount, crudMessage) {

        if (retryCount === 0) {
            //check if it is already disabled
            if (trigger.status && trigger.status.active === false) {
                return Promise.resolve(triggerID);
            }

            var message = `Automatically disabled trigger while ${crudMessage}`;
            var status = {
                'active': false,
                'dateChanged': Date.now(),
                'reason': {'kind': 'AUTO', 'statusCode': undefined, 'message': message}
            };
            trigger.status = status;
        }

        return new Promise(function(resolve, reject) {

    console.log('ZZZ DB insert disable ', triggerID);
            utilsDB.db.insert(trigger, triggerID, function (err) {
                if (err) {
                    if (err.statusCode === 409 && retryCount < 5) {
                        setTimeout(function () {
                            utilsDB.disableTrigger(triggerID, trigger, (retryCount + 1))
                            .then(id => {
    console.log('ZZZ DB insert resolve on retry ', triggerID);
                                resolve(id);
                            })
                            .catch(err => {
                                reject(err);
                            });
                        }, 1000);
                    }
                    else {
                        reject(common.sendError(err.statusCode, 'there was an error while disabling the trigger in the database.', err.message));
                    }
                }
                else {
    console.log('ZZZ DB insert disable wins ', triggerID);
                    resolve(triggerID);
                }
            });
        });

    };

    this.deleteTrigger = function(triggerID, retryCount) {

        return new Promise(function(resolve, reject) {

    console.log('ZZZ DB get delete ', triggerID);
            utilsDB.db.get(triggerID, function (err, existing) {
                if (!err) {
    console.log('ZZZ DB destroy on delete ', triggerID);
                    utilsDB.db.destroy(existing._id, existing._rev, function (err) {
                        if (err) {
                            if (err.statusCode === 409 && retryCount < 5) {
                                setTimeout(function () {
                                    utilsDB.deleteTrigger(triggerID, (retryCount + 1))
                                    .then(resolve)
                                    .catch(err => {
                                        reject(err);
                                    });
                                }, 1000);
                            }
                            else {
                                reject(common.sendError(err.statusCode, 'there was an error while deleting the trigger from the database.', err.message));
                            }
                        }
                        else {
                            resolve();
                        }
                    });
                }
                else {
                    var qName = triggerID.split('/');
                    var name = '/' + qName[1] + '/' + qName[2];
                    reject(common.sendError(err.statusCode, 'could not find trigger ' + name + ' in the database'));
                }
            });
        });
    };

    this.updateTrigger = function(triggerID, trigger, params, retryCount) {

        if (retryCount === 0) {
            for (var key in params) {
                trigger[key] = params[key];
            }
            var status = {
                'active': true,
                'dateChanged': Date.now()
            };
            trigger.status = status;
        }

        return new Promise(function(resolve, reject) {
    console.log('ZZZ DB insert on update ', triggerID);
            utilsDB.db.insert(trigger, triggerID, function (err) {
                if (err) {
                    if (err.statusCode === 409 && retryCount < 5) {
                        setTimeout(function () {
                            utilsDB.updateTrigger(triggerID, trigger, params, (retryCount + 1))
                            .then(id => {
    console.log('ZZZ DB insert on update wins2 ', triggerID);
                                resolve(id);
                            })
                            .catch(err => {
                                reject(err);
                            });
                        }, 1000);
                    }
                    else {
                        reject(common.sendError(err.statusCode, 'there was an error while updating the trigger in the database.', err.message));
                    }
                }
                else {
    console.log('ZZZ DB insert on update wins ', triggerID);
                    resolve(triggerID);
                }
            });
        });
    };

};
