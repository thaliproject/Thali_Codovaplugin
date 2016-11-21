'use strict';

var os = require('os');
var tmp = require('tmp');
var PouchDB = require('pouchdb');
var LeveldownMobile = require('leveldown-mobile');
var PouchDBGenerator = require('thali/NextGeneration/utils/pouchDBGenerator');
var path = require('path');
var Promise = require('bluebird');
var https = require('https');
var logger = require('thali/ThaliLogger')('testUtils');
var ForeverAgent = require('forever-agent');
var thaliConfig = require('thali/NextGeneration/thaliConfig');
var expressPouchdb = require('express-pouchdb');
var platform = require('thali/NextGeneration/utils/platform');
var makeIntoCloseAllServer = require('thali/NextGeneration/makeIntoCloseAllServer');
var notificationBeacons =
  require('thali/NextGeneration/notification/thaliNotificationBeacons');
var express = require('express');
var fs = require('fs-extra-promise');

var pskId = 'yo ho ho';
var pskKey = new Buffer('Nothing going on here');

var doToggle = function (toggleFunction, on) {
  if (typeof Mobile === 'undefined') {
    return Promise.resolve();
  }
  if (platform.isIOS) {
    return Promise.resolve();
  }
  return new Promise(function (resolve, reject) {
    Mobile[toggleFunction](on, function (err) {
      if (err) {
        logger.warn('Mobile.%s returned an error: %s', toggleFunction, err);
        return reject(new Error(err));
      }
      return resolve();
    });
  });
};

module.exports.toggleWifi = function (on) {
  return doToggle('toggleWiFi', on);
};

exports.toggleBluetooth = function (on) {
  return doToggle('toggleBluetooth', on);
};

/**
 * Turn Bluetooth and Wifi either on or off.
 * This doesn't have any effect on iOS and on mocked up desktop
 * environment, the network changes will be simulated (i.e., doesn't affect
 * the network status of the host machine).
 * @param {boolean} on Pass true to turn radios on and false to turn them off
 * @returns {Promise<?Error>}
 */
module.exports.toggleRadios = function (on) {
  logger.info('Toggling radios to: %s', on);
  return module.exports.toggleBluetooth(on)
  .then(function () {
    return module.exports.toggleWifi(on);
  });
};

function isFunction(functionToCheck) {
  var getType = {};
  return functionToCheck && getType.toString.call(functionToCheck) ===
    '[object Function]';
}

var myName = '';
var myNameCallback = null;

/**
 * Set the name given used by this device. The name is
 * retrievable via a function exposed to the Cordova side.
 * @param {string} name
 */
module.exports.setName = function (name) {
  myName = name;
  if (isFunction(myNameCallback)) {
    myNameCallback(name);
  } else {
    logger.warn('myNameCallback not set!');
  }
};

/**
 * Get the name of this device.
 */
module.exports.getName = function () {
  return myName;
};

if (platform._isRealMobile) {
  Mobile('setMyNameCallback').registerAsync(function (callback) {
    myNameCallback = callback;
    // If the name is already set, pass it to the callback
    // right away.
    if (myName) {
      myNameCallback(myName);
    }
  });
}

/**
 * Returns the file path to the temporary directory that can be used by tests
 * to store temporary data.
 * On desktop, returns a directory that does not persist between app restarts
 * and is removed when the process exits.
 * @returns {string}
 */
var tmpObject = null;
function tmpDirectory () {
  if (platform._isRealMobile) {
    return os.tmpdir();
  }

  tmp.setGracefulCleanup();
  if (tmpObject === null) {
    tmpObject = tmp.dirSync({
      unsafeCleanup: true
    });
  }
  return tmpObject.name;
}
module.exports.tmpDirectory = tmpDirectory;

/**
 * Returns a promise that resolved with true or false depending on if this
 * device has the hardware capabilities required.
 * On Android, checks the BLE multiple advertisement feature and elsewhere
 * always resolves with true.
 */
module.exports.hasRequiredHardware = function () {
  return new Promise(function (resolve) {
    if (platform._isRealAndroid) {
      var checkBleMultipleAdvertisementSupport = function () {
        Mobile('isBleMultipleAdvertisementSupported').callNative(
          function (error, result) {
            if (error) {
              logger.warn('BLE multiple advertisement error: ' + error);
              resolve(false);
              return;
            }
            switch (result) {
              case 'Not resolved': {
                logger.info(
                  'BLE multiple advertisement support not yet resolved'
                );
                setTimeout(checkBleMultipleAdvertisementSupport, 5000);
                break;
              }
              case 'Supported': {
                logger.info('BLE multiple advertisement supported');
                resolve(true);
                break;
              }
              case 'Not supported': {
                logger.info('BLE multiple advertisement not supported');

                resolve(false);
                break;
              }
              default: {
                logger.warn('BLE multiple advertisement issue: ' + result);
                resolve(false);
              }
            }
          }
        );
      };
      checkBleMultipleAdvertisementSupport();
    } else {
      resolve(true);
    }
  });
};

module.exports.returnsValidNetworkStatus = function () {
  // The require is here instead of top of file so that
  // we can require the test utils also from an environment
  // where Mobile isn't defined (which is a requirement when
  // thaliMobile is required).
  var ThaliMobile = require('thali/NextGeneration/thaliMobile');
  // Check that network status is as expected and
  // report to CI that this device is ready.
  return ThaliMobile.getNetworkStatus()
  .then(function (networkStatus) {
    logger.debug(
      'Device did not have required hardware capabilities!'
    );
    if (networkStatus.bluetoothLowEnergy === 'on') {
      // If we are on a device that doesn't have required capabilities
      // the network status for BLE must not be reported to be "on"
      // which would mean "The radio is on and available for use."
      return Promise.resolve(false);
    } else {
      return Promise.resolve(true);
    }
  });
};

module.exports.getOSVersion = function () {
  return new Promise(function (resolve) {
    if (!platform._isRealMobile) {
      return resolve('dummy');
    }
    Mobile('getOSVersion').callNative(function (version) {
      resolve(version);
    });
  });
};


module.exports.verifyCombinedResultSuccess =
  function (t, combinedResult, message) {
    t.equal(combinedResult.wifiResult, null,
      message || 'error should be null');
    t.equal(combinedResult.nativeResult, null,
      message || 'error should be null');
  };

// Short, random and globally unique name can be obtained from current
// timestamp. For example '1w8ueaswm1'
var getUniqueRandomName = function () {
  var time = process.hrtime();
  time = time[0] * Math.pow(10, 9) + time[1];
  return time.toString(36);
};
module.exports.getUniqueRandomName = getUniqueRandomName;

var preAmbleSizeInBytes = notificationBeacons.PUBLIC_KEY_SIZE +
  notificationBeacons.EXPIRATION_SIZE;

module.exports.extractPreAmble = function (beaconStreamWithPreAmble) {
  return beaconStreamWithPreAmble.slice(0, preAmbleSizeInBytes);
};

module.exports.extractBeacon = function (beaconStreamWithPreAmble,
                                         beaconIndexToExtract) {
  var beaconStreamNoPreAmble =
    beaconStreamWithPreAmble.slice(preAmbleSizeInBytes);
  var beaconCount = 0;
  for (var i = 0; i < beaconStreamNoPreAmble.length;
       i += notificationBeacons.BEACON_SIZE) {
    if (beaconCount === beaconIndexToExtract) {
      return beaconStreamNoPreAmble
        .slice(i, i + notificationBeacons.BEACON_SIZE);
    }
    ++beaconCount;
  }
  return null;
};

function createResponseBody(response) {
  var completed = false;
  return new Promise(function (resolve, reject) {
    var responseBody = '';
    response.on('data', function (data) {
      logger.debug('Got response data')
      responseBody += data;
    });
    response.on('end', function () {
      logger.debug('Got end');
      completed = true;
      resolve(responseBody);
    });
    response.on('error', function (error) {
      if (!completed) {
        logger.error('response body error %j', error);
        reject(error);
      }
    });
    response.resume();
  });
}

module.exports.put = function (host, port, path, pskIdentity, pskKey,
                               requestBody) {
  return new Promise(function (resolve, reject) {
    var request = https.request({
      hostname: host,
      port: port,
      path: path,
      method: 'PUT',
      agent: new ForeverAgent.SSL({
        rejectUnauthorized: false,
        keepAlive: true,
        keepAliveMsecs: thaliConfig.TCP_TIMEOUT_WIFI/2,
        maxSockets: Infinity,
        maxFreeSockets: 256,
        ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
        pskIdentity: pskIdentity,
        pskKey: pskKey
      })
    }, function (response) {
      createResponseBody(response)
        .then(resolve)
        .catch(reject);
    });
    request.on('error', function (error) {
      logger.error('%j', error);
      reject(error);
    });
    request.write(requestBody);
    request.end();
  });
};

module.exports._get = function (host, port, path, options) {
  return new Promise(function (resolve, reject) {
    var request = https.request(options, function (response) {
      createResponseBody(response)
        .then(resolve)
        .catch(reject);
    });
    request.on('error', function (error) {
      logger.error('_get got error %j', error);
      reject(error);
    });
    // Wait for 15 seconds since the request can take a while
    // in mobile environment over a non-TCP transport.
    request.setTimeout(15 * 1000);
    request.end();
  });
};

module.exports.get = function (host, port, path, pskIdentity, pskKey) {
  var options = {
    hostname: host,
    port: port,
    path: path,
    agent: new ForeverAgent.SSL({
      keepAlive: true,
      keepAliveMsecs: thaliConfig.TCP_TIMEOUT_WIFI/2,
      maxSockets: Infinity,
      maxFreeSockets: 256,
      ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
      pskIdentity: pskIdentity,
      pskKey: pskKey
    })
  };
  return module.exports._get(host, port, path, options);
};

module.exports.getWithAgent = function (host, port, path, agent) {
  var options = {
    hostname: host,
    port: port,
    path: path,
    agent: agent
  };
  return module.exports._get(host, port, path, options);
};

/**
 * @typedef {Object} peerAndBody
 * @property {string} httpResponseBody
 * @property {string} peerId
 */

/**
 * This function will grab the first peer it can via nonTCPAvailableHandler and
 * will try to issue the GET request. If it fails then it will continue to
 * listen to nonTCPAvailableHandler until it sees a port for the same PeerID
 * and will try the GET again. It will repeat this process if there are
 * failures until the timer runs out.
 *
 * @param {string} path
 * @param {string} pskIdentity
 * @param {Buffer} pskKey
 * @param {?string} [selectedPeerId] This is only used for a single test that
 * needs to reconnect to a known peer, otherwise it is null.
 * @returns {Promise<Error | peerAndBody>}
 */
module.exports.getSamePeerWithRetry = function (path, pskIdentity, pskKey,
                                                selectedPeerId) {
  // We don't load thaliMobileNativeWrapper until after the tests have started
  // running so we pick up the right version of mobile
  var thaliMobileNativeWrapper = require('thali/NextGeneration/thaliMobileNativeWrapper');
  return new Promise(function (resolve, reject) {
    var retryCount = 0;
    var MAX_TIME_TO_WAIT_IN_MILLISECONDS = 1000 * 30 * 2;
    var exitCalled = false;
    var peerID = selectedPeerId;
    var getRequestPromise = null;

    function exitCall(success, failure) {
      if (exitCalled) {
        return;
      }
      exitCalled = true;
      clearTimeout(timeoutId);
      thaliMobileNativeWrapper.emitter
        .removeListener('nonTCPPeerAvailabilityChangedEvent',
          nonTCPAvailableHandler);
      return failure ? reject(failure) : resolve(
        {
          httpResponseBody: success,
          peerId: peerID
        });
    }

    var timeoutId = setTimeout(function () {
      exitCall(null, new Error('Timer expired'));
    }, MAX_TIME_TO_WAIT_IN_MILLISECONDS);

    function tryAgain(portNumber) {
      ++retryCount;
      logger.warn('Retry count for getSamePeerWithRetry is ' + retryCount);
      getRequestPromise =
        module.exports.get('127.0.0.1', portNumber, path, pskIdentity, pskKey);
      getRequestPromise
        .then(function (result) {
          exitCall(result);
        })
        .catch(function (err) {
          logger.debug('getSamePeerWithRetry got an error it will retry - ' +
            err);
        });
    }

    function nonTCPAvailableHandler(record) {
      // Ignore peer unavailable events
      if (record.portNumber === null) {
        if (peerID && record.peerIdentifier === peerID) {
          logger.warn('We got a peer unavailable notification for a ' +
            'peer we are looking for.');
        }
        return;
      }

      if (peerID && record.peerIdentifier !== peerID) {
        return;
      }

      logger.debug('We got a peer ' + JSON.stringify(record));

      if (!peerID) {
        peerID = record.peerIdentifier;
        return tryAgain(record.portNumber);
      }


      // We have a predefined peerID
      if (!getRequestPromise) {
        return tryAgain(record.portNumber);
      }

      getRequestPromise
        .then(function () {
          // In theory this could maybe happen if a connection somehow got
          // cut before we were notified of a successful result thus causing
          // the system to automatically issue a new port, but that is
          // unlikely
        })
        .catch(function (err) {
          return tryAgain(record.portNumber, err);
        });
    }

    thaliMobileNativeWrapper.emitter.on('nonTCPPeerAvailabilityChangedEvent',
      nonTCPAvailableHandler);
  });
};

module.exports.validateCombinedResult = function (combinedResult) {
  if (combinedResult.wifiResult !== null ||
    combinedResult.nativeResult !== null) {
    return Promise.reject(new Error('Had a failure in ThaliMobile.start - ' +
      JSON.stringify(combinedResult)));
  }
  return Promise.resolve();
};

var MAX_FAILURE = 10;

function turnParticipantsIntoBufferArray (t, devicePublicKey) {
  var publicKeys = [];
  t.participants.forEach(function (participant) {
    var publicKey = new Buffer(participant.data);
    if (Buffer.compare(publicKey, devicePublicKey) !== 0) {
      publicKeys.push(publicKey);
    }
  });
  return publicKeys;
}

module.exports.turnParticipantsIntoBufferArray =
  turnParticipantsIntoBufferArray;

module.exports.startServerInfrastructure =
  function (thaliNotificationServer, publicKeys, ThaliMobile, router) {
    return thaliNotificationServer.start(publicKeys)
      .then(function () {
        return ThaliMobile.start(router,
          thaliNotificationServer.getPskIdToSecret());
      })
      .then(function (combinedResult) {
        return module.exports.validateCombinedResult(combinedResult);
      })
      .then(function () {
        return ThaliMobile.startListeningForAdvertisements();
      })
      .then(function (combinedResult) {
        return module.exports.validateCombinedResult(combinedResult);
      })
      .then(function () {
        return ThaliMobile.startUpdateAdvertisingAndListening();
      })
      .then(function (combinedResult) {
        return module.exports.validateCombinedResult(combinedResult);
      });
  };

module.exports.runTestOnAllParticipants = function (
  t, router,
  thaliNotificationClient,
  thaliNotificationServer,
  ThaliMobile,
  devicePublicKey,
  testToRun
) {
  var publicKeys = turnParticipantsIntoBufferArray(t, devicePublicKey);

  return new Promise(function (resolve, reject) {
    var completed = false;
    // Each participant is recorded via their public key
    // If the value is -1 then they are done
    // If the value is 0 then no test has completed
    // If the value is greater than 0 then that is how many failures there have
    // been.

    var participantCount = publicKeys.reduce(function (participantCount,
                                                       participantPublicKey) {
      participantCount[participantPublicKey] = 0;
      return participantCount;
    }, {});

    var participantTask = publicKeys.reduce(function (participantTask,
                                                      participantPublicKey) {
      participantTask[participantPublicKey] = Promise.resolve();
      return participantTask;
    }, {});

    function success(publicKey) {
      if (completed) {
        return;
      }

      participantCount[publicKey] = -1;

      var hasParticipant = Object.keys(participantCount)
      .some(function (participantKey) {
        return participantCount[participantKey] !== -1;
      });
      if (hasParticipant) {
        return;
      }

      completed = true;
      clearTimeout(timerCancel);
      resolve();
    }

    function fail(publicKey, error) {
      logger.error('Got an err - ', error.toString());
      var count = participantCount[publicKey];
      if (completed || count === -1) {
        return;
      }
      count ++;
      participantCount[publicKey] = count;
      if (count >= MAX_FAILURE) {
        completed = true;
        clearTimeout(timerCancel);
        reject(error);
      }
    }

    var timerCancel = setTimeout(function () {
      reject(new Error('Test timed out'));
    }, 5 * 60 * 1000);

    thaliNotificationClient.on(
      thaliNotificationClient.Events.PeerAdvertisesDataForUs,
      function (notificationForUs) {
        if (completed) {
          return;
        }
        participantTask[notificationForUs.keyId]
        .then(function () {
          if (!completed) {
            var task = testToRun(notificationForUs)
            .then(function () {
              success(notificationForUs.keyId);
            })
            .catch(function (error) {
              fail(notificationForUs.keyId, error);
              return Promise.resolve(error);
            });
            participantTask[notificationForUs.keyId] = task;
            return task;
          }
        });
      });

    thaliNotificationClient.start(publicKeys);
    return module.exports.startServerInfrastructure(
      thaliNotificationServer, publicKeys, ThaliMobile, router
    )
    .catch(function (err) {
      reject(err);
    });
  });
};

// We doesn't want our test to run infinite time.
// We will replace t.end with custom exit function.
module.exports.testTimeout = function (t, timeout, callback) {
  var timer = setTimeout(function () {
    t.fail('test timeout');
    t.end();
  }, timeout);

  var oldEnd = t.end;
  t.end = function () {
    // Restoring original t.end.
    t.end = oldEnd;

    if (typeof callback === 'function') {
      callback();
    }

    clearTimeout(timer);
    return oldEnd.apply(this, arguments);
  };
};

module.exports.checkArgs = function (t, spy, description, args) {
  t.ok(spy.calledOnce, description + ' was called once');

  var currentArgs = spy.getCalls()[0].args;
  t.equals(
    args.length, currentArgs.length,
    description + ' was called with ' + currentArgs.length + ' arguments'
  );

  args.forEach(function (arg, index) {
    var argDescription = description + ' was called with \'' +
      arg.description + '\' as ' + (index + 1) + '-st argument';
    t.ok(arg.compare(currentArgs[index]), argDescription);
  });
};


// -- pouchdb --

var pouchDBTestDirectory = path.join(tmpDirectory(), 'pouchdb-test-directory');
fs.ensureDirSync(pouchDBTestDirectory);
module.exports.getPouchDBTestDirectory = function () {
  return pouchDBTestDirectory;
};

function getLevelDownPouchDb() {
  // Running each PouchDB in different directory.
  var defaultDirectory = path.join(pouchDBTestDirectory, getUniqueRandomName());
  fs.ensureDirSync(defaultDirectory);
  return PouchDBGenerator(PouchDB, defaultDirectory, {
    defaultAdapter: LeveldownMobile
  });
}

module.exports.getLevelDownPouchDb = getLevelDownPouchDb;

module.exports.getRandomlyNamedTestPouchDBInstance = function () {
  return new getLevelDownPouchDb()(getUniqueRandomName());
};

module.exports.getRandomPouchDBName = getUniqueRandomName;

var createPskPouchDBRemote = function (
  serverPort, dbName,
  pskId, pskKey, host
) {
  var serverUrl = 'https://' + (host ? host : '127.0.0.1') + ':' + serverPort +
    thaliConfig.BASE_DB_PATH + '/' + dbName;

  // See the notes in thaliReplicationPeerAction.start for why the below
  // is here and why it's wrong and should use agent instead but can't.
  return new getLevelDownPouchDb()(
    serverUrl, {
      ajax: {
        agent: new ForeverAgent.SSL({
          keepAlive: true,
          keepAliveMsecs: thaliConfig.TCP_TIMEOUT_WIFI/2,
          maxSockets: Infinity,
          maxFreeSockets: 256,
          ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
          pskIdentity: pskId,
          pskKey: pskKey
        })
      }
    }
  );
};
module.exports.createPskPouchDBRemote = createPskPouchDBRemote;

module.exports.setUpServer = function (testBody, appConfig) {
  var app = express();
  appConfig && appConfig(app);
  app.use(
    thaliConfig.BASE_DB_PATH,
    expressPouchdb(
      getLevelDownPouchDb(),
      { mode: 'minimumForPouchDB' }
    )
  );
  var testCloseAllServer = makeIntoCloseAllServer(
    https.createServer(
      {
        ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
        pskCallback: function (id) {
          return id === pskId ? pskKey : null;
        }
      },
      app
    )
  );
  testCloseAllServer.listen(
    0,
    function () {
      var serverPort = testCloseAllServer.address().port;
      var randomDBName = getUniqueRandomName();
      var remotePouchDB = createPskPouchDBRemote(
        serverPort, randomDBName, pskId, pskKey
      );
      testBody(serverPort, randomDBName, remotePouchDB);
    }
  );
  return testCloseAllServer;
};

/**
 * Stubs `dns.lookup` function such a way, that attempt to connect to
 * `unresolvableDomain` fails immediately.
 *
 * TODO: update implementation to allow multiple domains to be unresolvable
 *
 * @param {string} unresolvableDomain
 */
module.exports.makeDomainUnresolvable = function (unresolvableDomain) {
  var dns = require('dns');
  if (dns.__originalLookup) {
    throw new Error('makeDomainUnresolvable can\'t be called twice without ' +
      'calling restoreUnresolvableDomains');
  }
  dns.__originalLookup = dns.lookup;
  dns.lookup = function (domain, family_, callback_) {
    var family = family_,
        callback = callback_;
    // parse arguments
    if (arguments.length === 2) {
      callback = family;
    }
    if (domain === unresolvableDomain) {
      var syscall = 'getaddrinfo';
      var errorno = 'ENOTFOUND';
      var e = new Error(syscall + ' ' + errorno);
      e.errno = e.code = errorno;
      e.syscall = syscall;
      setImmediate(callback, e);
    } else {
      return dns.__originalLookup.apply(dns, arguments);
    }
  };
};

module.exports.restoreUnresolvableDomains = function () {
  var dns = require('dns');
  if (dns.__originalLookup) {
    dns.lookup = dns.__originalLookup;
    delete dns.__originalLookup;
  }
};
