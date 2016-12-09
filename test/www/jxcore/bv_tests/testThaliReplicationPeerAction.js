'use strict';

var tape = require('../lib/thaliTape');
var net = require('net');
var crypto = require('crypto');
var thaliConfig = require('thali/NextGeneration/thaliConfig');
var Promise = require('bluebird');
var platform = require('thali/NextGeneration/utils/platform');
var testUtils = require('../lib/testUtils');
var makeIntoCloseAllServer = require('thali/NextGeneration/makeIntoCloseAllServer');
var https = require('https');
var httpTester = require('../lib/httpTester');
var ThaliReplicationPeerAction = require('thali/NextGeneration/replication/thaliReplicationPeerAction');
var thaliMobileNativeWrapper = require('thali/NextGeneration/thaliMobileNativeWrapper');
var PeerAction = require('thali/NextGeneration/thaliPeerPool/thaliPeerAction');
var ForeverAgent = require('forever-agent');

var devicePublicPrivateKey = crypto.createECDH(thaliConfig.BEACON_CURVE);
var devicePublicKey = devicePublicPrivateKey.generateKeys();
var testCloseAllServer = null;
var pskId = 'yo ho ho';
var pskKey = new Buffer('Nothing going on here');
var thaliReplicationPeerAction = null;

var httpAgentPool = new ForeverAgent.SSL({
  rejectUnauthorized: false,
  maxSockets: 8,
  ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
  pskIdentity: pskId,
  pskKey: pskKey
});

var test = tape({
  setup: function (t) {
    t.end();
  },
  teardown: function (t) {
    Promise.resolve()
    .then(function () {
      if (thaliReplicationPeerAction) {
        thaliReplicationPeerAction.kill();
        return thaliReplicationPeerAction.waitUntilKilled();
      }
    })
    .then(function () {
      if (testCloseAllServer) {
        var promise = testCloseAllServer.closeAllPromise();
        testCloseAllServer = null;
        return promise;
      }
    })
    .catch(function (err) {
      t.fail('Got error in teardown ' + err);
    })
    .then(function () {
      t.end();
    });
  }
});

function failedRequest(t, serverPort, catchHandler) {
  var notificationForUs = {
    keyId: new Buffer('abcdefg'),
    portNumber: serverPort,
    hostAddress: '127.0.0.1',
    pskIdentifyField: pskId,
    psk: pskKey,
    suggestedTCPTimeout: 10000,
    connectionType: thaliMobileNativeWrapper.connectionTypes.TCP_NATIVE
  };
  thaliReplicationPeerAction =
    new ThaliReplicationPeerAction(notificationForUs,
      testUtils.getLevelDownPouchDb(),
      'Serverisnotthere',
      devicePublicKey);
  return thaliReplicationPeerAction.start(httpAgentPool)
    .then(function () {
      t.fail('We succeeded?');
    })
    .catch(catchHandler)
    .then(function () {
      t.end();
    });
}

test('Server is not there', function (t) {
  testCloseAllServer = makeIntoCloseAllServer(net.createServer(), true);
  testCloseAllServer.listen(0, function () {
    var serverPort = testCloseAllServer.address().port;
    // This provides a non zero probability that serverPort is available
    testCloseAllServer.closeAllPromise()
      .then(function () {
        return failedRequest(t, serverPort, function (err) {
          t.equal(err.message, 'Could not establish TCP connection',
            'right error');
        });
      })
      .catch(function (err) {
        t.fail('Got error - ' + err);
        t.end();
      });
  });
});

test('Server accepts & closes connection', function (t) {
  testCloseAllServer = makeIntoCloseAllServer(net.createServer(
    function (socket) {
      socket.end();
    }), true);
  testCloseAllServer.listen(0, function () {
    var serverPort = testCloseAllServer.address().port;
    failedRequest(t, serverPort, function (err) {
      t.equal(err.message,
        'Could establish TCP connection but couldn\'t keep it running',
        'right error');
    });
  });
});

function returnErrorCode(t, statusCode) {
  var options = {
    ciphers : thaliConfig.SUPPORTED_PSK_CIPHERS,
    pskCallback : function (id) {
      return id === pskId ? pskKey : null;
    },
    key: thaliConfig.BOGUS_KEY_PEM,
    cert: thaliConfig.BOGUS_CERT_PEM
  };
  testCloseAllServer = makeIntoCloseAllServer(
    https.createServer(options, function (req, res) {
      res.writeHead(statusCode, 'Nobody home');
      res.end();
    }));
  testCloseAllServer.listen(0, function () {
    var serverPort = testCloseAllServer.address().port;
    failedRequest(t, serverPort, function (err) {
      t.equal(err.status, statusCode, 'Got error as expected');
    });
  });
}

test('Server always returns 500', function (t) {
  return returnErrorCode(t, 500);
});

test('Server always returns 401', function (t) {
  return returnErrorCode(t, 401);
});

test('Server always returns 403', function (t) {
  return returnErrorCode(t, 403);
});

/*
Create docs as test starts
Have a change detector to see docs come in and when we have them all end
 */

function createDocs(pouchDB, numberDocs) {
  var promises = [];
  var docs = [];
  for (var i = 0; i < numberDocs; ++i) {
    var doc = {
      _id: '' + i,
      title: 'something ' + i
    };
    promises.push(pouchDB.put(doc));
    docs.push(doc);
  }
  return Promise.all(promises)
    .then(function () {
      return docs;
    });
}

function matchDocsInChanges(pouchDB, docs, thaliPeerReplicationAction) {
  if (docs.length <= 0) {
    throw new Error('bad docs length');
  }
  var docsIndex = 0;
  return new Promise(function (resolve, reject) {
    var cancel = pouchDB.changes({
      since: 0,
      live: true,
      // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
      include_docs: true
      // jscs:enable requireCamelCaseOrUpperCaseIdentifiers
    }).on('change', function (change) {
      if (change.doc._id !== docs[docsIndex]._id ||
          change.doc.title !== docs[docsIndex].title) {
        cancel.cancel();
        reject('bad doc');
      }
      ++docsIndex;
      if (docsIndex === docs.length) {
        return cancel.cancel();
      }

      if (docsIndex > docs.length) {
        reject('Bad count');
      }
    }).on('complete', function () {
      // Give sequence updater enough time to run before killing everything but
      // it should be less then max idle period. Otherwise action will be
      // completed with "No activity time out" error.
      var timeout =
        ThaliReplicationPeerAction.MAX_IDLE_PERIOD_SECONDS * 1000 - 500;
      setTimeout(function () {
        Promise.resolve()
        .then(function () {
          if (thaliPeerReplicationAction) {
            thaliPeerReplicationAction.kill();
            return thaliPeerReplicationAction.waitUntilKilled();
          }
        })
        .then(resolve);
      }, timeout);
    }).on ('error', function (err) {
      reject('got error ' + err);
    });
  });
}

test('Make sure docs replicate',
  function () {
    // FIXME: iOS is too slow for this test (#1618)
    return platform._isRealIOS;
  },
  function (t) {
    testCloseAllServer = testUtils.setUpServer(function (serverPort,
                                                         randomDBName,
                                                         remotePouchDB) {
      var thaliReplicationPeerAction = null;
      var DifferentDirectoryPouch = testUtils.getLevelDownPouchDb();
      var localPouchDB = new DifferentDirectoryPouch(randomDBName);
      createDocs(remotePouchDB, 10)
      .then(function (docs) {
        var notificationForUs = {
          keyId: new Buffer('abcdefg'),
          portNumber: serverPort,
          hostAddress: '127.0.0.1',
          pskIdentifyField: pskId,
          psk: pskKey,
          suggestedTCPTimeout: 10000,
          connectionType: thaliMobileNativeWrapper.connectionTypes.TCP_NATIVE
        };
        var promises = [];
        thaliReplicationPeerAction =
         new ThaliReplicationPeerAction(notificationForUs,
           DifferentDirectoryPouch, randomDBName,
           devicePublicKey);
        promises.push(thaliReplicationPeerAction.start(httpAgentPool));
        promises.push(matchDocsInChanges(localPouchDB, docs,
                     thaliReplicationPeerAction));
        return Promise.all(promises);
      })
      .then(function () {
        return remotePouchDB.info();
      })
      .then(function (info) {
        return httpTester.validateSeqNumber(t, randomDBName, serverPort,
        // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
        info.update_seq, pskId, pskKey, devicePublicKey, null, 10);
        // jscs:enable requireCamelCaseOrUpperCaseIdentifiers
      })
      .then(function () {
        t.pass('All tests passed!');
      })
      .catch(function (err) {
        t.fail('failed with ' + err);
      })
      .then(function () {
        t.end();
      });
    });
  });

test('Do nothing and make sure we time out',
  function () {
    // FIXME: iOS is too slow for this test (#1618)
    return platform._isRealIOS;
  },
  function (t) {
    function onServerSetUp (serverPort, randomDBName) {
      var thaliReplicationPeerAction = null;
      var notificationForUs = {
        keyId: new Buffer('abcdefg'),
        portNumber: serverPort,
        hostAddress: '127.0.0.1',
        pskIdentifyField: pskId,
        psk: pskKey,
        suggestedTCPTimeout: 10000,
        connectionType: thaliMobileNativeWrapper.connectionTypes.TCP_NATIVE
      };
      // Using a different directory really shouldn't make any difference
      // to this particular test but I'm being paranoid
      var DifferentDirectoryPouch = testUtils.getLevelDownPouchDb();
      var originalTimeout = ThaliReplicationPeerAction.MAX_IDLE_PERIOD_SECONDS;
      ThaliReplicationPeerAction.MAX_IDLE_PERIOD_SECONDS = 2;
      thaliReplicationPeerAction =
        new ThaliReplicationPeerAction(notificationForUs,
          DifferentDirectoryPouch, randomDBName,
          devicePublicKey);
      thaliReplicationPeerAction.start(httpAgentPool)
      .then(function () {
        t.fail('We should have failed with time out.');
      })
      .catch(function (err) {
        t.equal(thaliReplicationPeerAction.getActionState(),
                PeerAction.actionState.KILLED,
                'action should be killed');
        t.equal(err.message, 'No activity time out', 'Error should be timed ' +
          'out');
        return httpTester.getSeqDoc(randomDBName, serverPort, pskId, pskKey,
                                    devicePublicKey);
      })
      .then(function () {
        t.fail('The seq request should have failed');
      })
      .catch(function (err) {
        t.equal(err.statusCode, 404, 'No doc found');
      })
      .then(function () {
        ThaliReplicationPeerAction.MAX_IDLE_PERIOD_SECONDS = originalTimeout;
        t.end();
      });
    }
    testCloseAllServer = testUtils.setUpServer(onServerSetUp);
  }
);

test('Do something and make sure we time out',
  function () {
    // FIXME: iOS is too slow for this test (#1618)
    return platform._isRealIOS;
  },
  function (t) {
    function onServerSetUp (serverPort, randomDBName, remotePouchDB) {
      var thaliReplicationPeerAction = null;
      var DifferentDirectoryPouch = testUtils.getLevelDownPouchDb();
      var localPouchDB = new DifferentDirectoryPouch(randomDBName);
      var thaliReplicationPeerActionStartOutput = null;
      var originalTimeout = ThaliReplicationPeerAction.MAX_IDLE_PERIOD_SECONDS;
      ThaliReplicationPeerAction.MAX_IDLE_PERIOD_SECONDS = 2;

      createDocs(remotePouchDB, 10)
      .then(function (docs) {
        var notificationForUs = {
          keyId: new Buffer('abcdefg'),
          portNumber: serverPort,
          hostAddress: '127.0.0.1',
          pskIdentifyField: pskId,
          psk: pskKey,
          suggestedTCPTimeout: 10000,
          connectionType: thaliMobileNativeWrapper.connectionTypes.TCP_NATIVE
        };
        thaliReplicationPeerAction =
          new ThaliReplicationPeerAction(notificationForUs,
            DifferentDirectoryPouch, randomDBName,
            devicePublicKey);
        thaliReplicationPeerActionStartOutput =
          thaliReplicationPeerAction.start(httpAgentPool);
        thaliReplicationPeerActionStartOutput
          .catch(function () {
            // So we don't get an unhandled rejection due a failure
            // in something else
          });
        return matchDocsInChanges(localPouchDB, docs);
      })
      .then(function () {
        return remotePouchDB.info();
      })
      .then(function (info) {
        return httpTester.validateSeqNumber(t, randomDBName, serverPort,
          // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
          info.update_seq, pskId, pskKey, devicePublicKey, null, 10);
        // jscs:enable requireCamelCaseOrUpperCaseIdentifiers
      })
      .catch(function (err) {
        return Promise.reject(err);
      })
      .then(function () {
        return thaliReplicationPeerActionStartOutput;
      })
      .then(function () {
        t.fail('Didn\'t get timeout');
      })
      .catch(function (err) {
        t.equal(thaliReplicationPeerAction.getActionState(),
          PeerAction.actionState.KILLED,
          'action should be killed');
        t.equal(err.message, 'No activity time out', 'Error should be timed ' +
          'out');
      })
      .then(function () {
        ThaliReplicationPeerAction.MAX_IDLE_PERIOD_SECONDS = originalTimeout;
        t.end();
      });
    }
    testCloseAllServer = testUtils.setUpServer(onServerSetUp);
  }
);

test('Start replicating and then catch error when server goes', function (t) {
  var requestCount = 0;
  function killServer(app) {
    app.use('*', function (req, res, next) {
      requestCount += 1;
      if (requestCount > 5) {
        return res.connection.destroy();
      }
      next();
    });
  }
  testCloseAllServer = testUtils.setUpServer(function (serverPort, randomDBName,
                                                       remotePouchDB) {
    var thaliReplicationPeerAction = null;
    var DifferentDirectoryPouch = testUtils.getLevelDownPouchDb();
    createDocs(remotePouchDB, 10)
      .then(function () {
        var notificationForUs = {
          keyId: new Buffer('abcdefg'),
          portNumber: serverPort,
          hostAddress: '127.0.0.1',
          pskIdentifyField: pskId,
          psk: pskKey,
          suggestedTCPTimeout: 10000,
          connectionType: thaliMobileNativeWrapper.connectionTypes.TCP_NATIVE
        };
        thaliReplicationPeerAction =
          new ThaliReplicationPeerAction(notificationForUs,
            DifferentDirectoryPouch, randomDBName,
            devicePublicKey);
        return thaliReplicationPeerAction.start(httpAgentPool);
      })
      .then(function () {
        t.fail('Start should have failed');
      })
      .catch(function (err) {
        t.ok(err.message.indexOf('socket hang up') === 0, 'socket hung up');
      })
      .then(function () {
        t.end();
      });
  }, killServer);
});

test('Make sure clone works', function (t) {
  var notificationForUs = {
    keyId: new Buffer('abcdefg'),
    portNumber: 12,
    hostAddress: '127.0.0.1',
    pskIdentifyField: pskId,
    psk: pskKey,
    suggestedTCPTimeout: 10000,
    connectionType: thaliMobileNativeWrapper.connectionTypes.TCP_NATIVE
  };
  var DifferentDirectoryPouch = testUtils.getLevelDownPouchDb();
  var dbName = 'icky';
  var originalThaliReplicationAction =
    new ThaliReplicationPeerAction(notificationForUs, DifferentDirectoryPouch,
    dbName, devicePublicKey);
  var clonedAction = originalThaliReplicationAction.clone();
  t.equal(clonedAction.getPeerAdvertisesDataForUs(),
    originalThaliReplicationAction.getPeerAdvertisesDataForUs(),
    'same getPeerAdvertisesDataForUs');
  t.equal(clonedAction._PouchDB, originalThaliReplicationAction._PouchDB,
    'Same pouchdB');
  t.equal(clonedAction._dbName, originalThaliReplicationAction._dbName,
    'same dbName');
  t.equal(clonedAction._ourPublicKey,
    originalThaliReplicationAction._ourPublicKey, 'Same public key');
  t.end();
});
