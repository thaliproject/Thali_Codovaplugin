'use strict';

var crypto         = require('crypto');
var express        = require('express');
var expressPouchDB = require('express-pouchdb');
var ForeverAgent   = require('forever-agent');
var Promise        = require('bluebird');

var tape      = require('../lib/thaliTape');
var testUtils = require('../lib/testUtils');

var thaliConfig                = require('thali/NextGeneration/thaliConfig');
var ThaliMobile                = require('thali/NextGeneration/thaliMobile');
var ThaliNotificationServer    = require('thali/NextGeneration/notification/thaliNotificationServer');
var ThaliNotificationClient    = require('thali/NextGeneration/notification/thaliNotificationClient');
var ThaliPeerPoolDefault       = require('thali/NextGeneration/thaliPeerPool/thaliPeerPoolDefault');
var ThaliReplicationPeerAction = require('thali/NextGeneration/replication/thaliReplicationPeerAction');

var devicePublicPrivateKey = crypto.createECDH(thaliConfig.BEACON_CURVE);
var devicePublicKey        = devicePublicPrivateKey.generateKeys();
var TestPouchDB            = testUtils.getLevelDownPouchDb();
var localPouchDB;

// Use peer's public key to determine local db name. This variable is used in scenario when
// we want to replicate with remote db which name is different than our local db.
// In that case, we are able to determine peer's remote db name based on it's public key.
// Use hex encoding to generate string without any special characters.
var LOCAL_DB_NAME_BASED_ON_PUBLIC_KEY = devicePublicKey.toString('hex').slice(0, 10);
var LOCAL_DB_NAME          = 'repActionTest';
var EXPIRATION_TIMEOUT     = 60 * 60 * 1000;
var ERROR_NO_DB_FILE       = 'no_db_file';

var platform = require('thali/NextGeneration/utils/platform');
//Temporarily switch off whole file for Android devices
if (platform._isRealAndroid) {
  return;
}

if (!tape.coordinated) {
  return;
}

var test = tape({
  setup: function (t) {
    t.data = devicePublicKey.toJSON();
    t.end();
  },
  teardown: function (t) {
    // Make sure we won't get any document conflicts during tests.
    if (localPouchDB) {
      localPouchDB.destroy();
    }
    t.end();
  }
});

test.skip('Coordinated replication action test - each device has the same local db name', function (t) {
  var router = express.Router();
  router.use(
    '/db',
    expressPouchDB(TestPouchDB, {
      mode: 'minimumForPouchDB'
    })
  );
  var thaliNotificationServer = new ThaliNotificationServer(
    router, devicePublicPrivateKey, EXPIRATION_TIMEOUT
  );
  var peerPool = new ThaliPeerPoolDefault();
  peerPool.start();
  var thaliNotificationClient = new ThaliNotificationClient(
    peerPool, devicePublicPrivateKey
  );
  var peerActions = [];

  localPouchDB = new TestPouchDB(LOCAL_DB_NAME);

  localPouchDB.put({
    _id: JSON.stringify(devicePublicKey.toJSON())
  })
  .then(function () {
    return testUtils.runTestOnAllParticipants(
      t, router,
      thaliNotificationClient,
      thaliNotificationServer,
      ThaliMobile,
      devicePublicKey,
      function (notificationForUs) {
        var thaliReplicationPeerAction = new ThaliReplicationPeerAction(
          notificationForUs, TestPouchDB, LOCAL_DB_NAME, devicePublicKey
        );
        peerActions.push(thaliReplicationPeerAction);

        return new Promise(function (resolve, reject) {
          var changes = localPouchDB.changes({
            since: 0,
            live: true
          });

          var exited = false;
          var resultError = null;
          function exit(error) {
            if (exited) {
              return;
            }
            exited = true;

            resultError = error;
            changes.cancel();
          }

          changes.on('change', function (change) {
            var bufferRemoteId = new Buffer(JSON.parse(change.id));
            // note that the test might pass before we even start replicating
            // because we already have the record from someone else, that's
            // fine. We still guarantee at least one replication ran on each
            // device.
            if (Buffer.compare(notificationForUs.keyId, bufferRemoteId) === 0) {
              exit();
            }
          })
          .on('error', function (error) {
            reject(error);
          })
          .on('complete', function () {
            if (resultError) {
              reject(resultError);
            } else {
              resolve();
            }
          });

          var httpAgentPool = new ForeverAgent.SSL({
            rejectUnauthorized: false,
            maxSockets: 8,
            ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
            pskIdentity: thaliReplicationPeerAction.getPskIdentity(),
            pskKey: thaliReplicationPeerAction.getPskKey()
          });

          thaliReplicationPeerAction.start(httpAgentPool)
          .catch(function (error) {
            exit(error);
          });
        });
      }
    )
  })

  .then(function () {
    return t.sync();
  })

  .then(function () {
    // We are simulating thaliPullReplicationFromNotification.stop() and
    // thaliPeerPoolDefault.stop()
    thaliNotificationClient.stop();
    var promises = peerActions.map(function (peerAction) {
      peerAction.kill();
      return peerAction.waitUntilKilled();
    });
    return Promise.all(promises);
  })
  .then(function () {
    // https://github.com/thaliproject/Thali_CordovaPlugin/issues/1138
    // workaround for ECONNREFUSED and ECONNRESET from 'request.js' in
    // 'pouchdb'.
    return t.sync();
  })
  .then(function () {
    return thaliNotificationServer.stop();
  })
  .then(function () {
    return ThaliMobile.stop();
  })
  .then(function (combinedResult) {
    if (
      combinedResult.wifiResult   !== null ||
      combinedResult.nativeResult !== null
    ) {
      return Promise.reject(
        new Error(
          'Had a failure in ThaliMobile.start - ',
          JSON.stringify(combinedResult)
        )
      );
    }
  })

  .then(function () {
    return Promise.resolve();
  })
  .then(function () {
    t.pass('passed');
  })
  .catch(function (error) {
    t.fail('failed with ' + error.toString());
  })
  .then(function () {
    t.end();
  });
});

test('Coordinated replication action test - each device has different local db name', function (t) {
  var router = express.Router();
  router.use(
    '/db',
    expressPouchDB(TestPouchDB, {
      mode: 'minimumForPouchDB'
    })
  );
  var thaliNotificationServer = new ThaliNotificationServer(
    router, devicePublicPrivateKey, EXPIRATION_TIMEOUT
  );
  var peerPool = new ThaliPeerPoolDefault();
  peerPool.start();
  var thaliNotificationClient = new ThaliNotificationClient(
    peerPool, devicePublicPrivateKey
  );
  var peerActions = [];

  localPouchDB = new TestPouchDB(LOCAL_DB_NAME_BASED_ON_PUBLIC_KEY);

  localPouchDB.put({
    _id: JSON.stringify(devicePublicKey.toJSON())
  })
    .then(function () {
      return testUtils.runTestOnAllParticipants(
        t, router,
        thaliNotificationClient,
        thaliNotificationServer,
        ThaliMobile,
        devicePublicKey,
        function (notificationForUs) {
          var thaliReplicationPeerAction = new ThaliReplicationPeerAction(
            notificationForUs, TestPouchDB, LOCAL_DB_NAME_BASED_ON_PUBLIC_KEY, devicePublicKey
          );
          peerActions.push(thaliReplicationPeerAction);

          return new Promise(function (resolve, reject) {
            var changes = localPouchDB.changes({
              since: 0,
              live: true
            });

            var exited = false;
            var resultError = null;
            function exit(error) {
              if (exited) {
                return;
              }
              exited = true;

              resultError = error;
              changes.cancel();
            }

            changes.on('change', function (change) {
              var bufferRemoteId = new Buffer(JSON.parse(change.id));
              // note that the test might pass before we even start replicating
              // because we already have the record from someone else, that's
              // fine. We still guarantee at least one replication ran on each
              // device.
              if (Buffer.compare(notificationForUs.keyId, bufferRemoteId) === 0) {
                exit();
              }
            })
              .on('error', function (error) {
                reject(error);
              })
              .on('complete', function () {
                if (resultError) {
                  reject(resultError);
                } else {
                  resolve();
                }
              });

            var httpAgentPool = new ForeverAgent.SSL({
              rejectUnauthorized: false,
              maxSockets: 8,
              ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
              pskIdentity: thaliReplicationPeerAction.getPskIdentity(),
              pskKey: thaliReplicationPeerAction.getPskKey()
            });

            // Use peer's public key to determine it's individual local db name
            var remoteDbName =
              thaliReplicationPeerAction.getPeerIdentifier().toString('hex').slice(0, 10);

            thaliReplicationPeerAction.start(httpAgentPool, remoteDbName)
              .catch(function (error) {
                exit(error);
              });
          });
        }
      )
    })

    .then(function () {
      return t.sync();
    })

    .then(function () {
      // We are simulating thaliPullReplicationFromNotification.stop() and
      // thaliPeerPoolDefault.stop()
      thaliNotificationClient.stop();
      var promises = peerActions.map(function (peerAction) {
        peerAction.kill();
        return peerAction.waitUntilKilled();
      });
      return Promise.all(promises);
    })
    .then(function () {
      // https://github.com/thaliproject/Thali_CordovaPlugin/issues/1138
      // workaround for ECONNREFUSED and ECONNRESET from 'request.js' in
      // 'pouchdb'.
      return t.sync();
    })
    .then(function () {
      return thaliNotificationServer.stop();
    })
    .then(function () {
      return ThaliMobile.stop();
    })
    .then(function (combinedResult) {
      if (
        combinedResult.wifiResult   !== null ||
        combinedResult.nativeResult !== null
      ) {
        return Promise.reject(
          new Error(
            'Had a failure in ThaliMobile.start - ',
            JSON.stringify(combinedResult)
          )
        );
      }
    })

    .then(function () {
      return Promise.resolve();
    })
    .then(function () {
      t.pass('passed');
    })
    .catch(function (error) {
      t.fail('failed with ' + error.toString());
    })
    .then(function () {
      t.end();
    });
});

test('Coordinated replication action test - should throw error when wrong remote db name is provided', function (t) {
  var wrongRemoteDbName = 'testDb';
  var router = express.Router();
  router.use(
    '/db',
    expressPouchDB(TestPouchDB, {
      mode: 'minimumForPouchDB'
    })
  );
  var thaliNotificationServer = new ThaliNotificationServer(
    router, devicePublicPrivateKey, EXPIRATION_TIMEOUT
  );
  var peerPool = new ThaliPeerPoolDefault();
  peerPool.start();
  var thaliNotificationClient = new ThaliNotificationClient(
    peerPool, devicePublicPrivateKey
  );
  var peerActions = [];
  var areWeDone = false;

  localPouchDB = new TestPouchDB(LOCAL_DB_NAME);

  localPouchDB.put({
    _id: JSON.stringify(devicePublicKey.toJSON())
  })
    .then(function () {
      return testUtils.runTestOnAllParticipants(
        t, router,
        thaliNotificationClient,
        thaliNotificationServer,
        ThaliMobile,
        devicePublicKey,
        function (notificationForUs) {
          var thaliReplicationPeerAction = new ThaliReplicationPeerAction(
            notificationForUs, TestPouchDB, LOCAL_DB_NAME, devicePublicKey
          );
          peerActions.push(thaliReplicationPeerAction);

          return new Promise(function (resolve, reject) {

            var httpAgentPool = new ForeverAgent.SSL({
              rejectUnauthorized: false,
              maxSockets: 8,
              ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
              pskIdentity: thaliReplicationPeerAction.getPskIdentity(),
              pskKey: thaliReplicationPeerAction.getPskKey()
            });

            // This should be rejected since we provided non existing remote db
            thaliReplicationPeerAction.start(httpAgentPool, wrongRemoteDbName)
              .then(function() {
                // It is possible that we will resolve even when the proper error occurred.
                // This is when we call _complete on already killed action.
                if (!areWeDone) {
                  var error = 'we should not be able to replicate with db that doesn\'t exist';
                  t.fail(error);
                  reject(new Error(error));
                }
              })
              .catch(function (error) {
                areWeDone = true;
                t.equals(error.reason, ERROR_NO_DB_FILE, 'error should be \'no_db_file\'');
                resolve(true);
              });
          });
        }
      )
    })

    .then(function () {
      return t.sync();
    })

    .then(function () {
      // We are simulating thaliPullReplicationFromNotification.stop() and
      // thaliPeerPoolDefault.stop()
      thaliNotificationClient.stop();
      var promises = peerActions.map(function (peerAction) {
        peerAction.kill();
        return peerAction.waitUntilKilled();
      });
      return Promise.all(promises);
    })
    .then(function () {
      // https://github.com/thaliproject/Thali_CordovaPlugin/issues/1138
      // workaround for ECONNREFUSED and ECONNRESET from 'request.js' in
      // 'pouchdb'.
      return t.sync();
    })
    .then(function () {
      return thaliNotificationServer.stop();
    })
    .then(function () {
      return ThaliMobile.stop();
    })
    .then(function (combinedResult) {
      if (
        combinedResult.wifiResult   !== null ||
        combinedResult.nativeResult !== null
      ) {
        return Promise.reject(
          new Error(
            'Had a failure in ThaliMobile.start - ',
            JSON.stringify(combinedResult)
          )
        );
      }
    })

    .then(function () {
      return Promise.resolve();
    })
    .then(function () {
      t.pass('passed');
    })
    .catch(function (error) {
      t.fail('failed with ' + error.toString());
    })
    .then(function () {
      t.end();
    });
});
