/*
 * This file needs to be renamed as app.js when we want to run unit tests
 * in order this to get loaded by the jxcore ready event.
 * This effectively acts as main entry point to the unit test app
 */

'use strict';

var platform = require('thali/NextGeneration/utils/platform');

if (typeof Mobile === 'undefined') {
  global.Mobile =
    require('./lib/wifiBasedNativeMock.js')(platform.names.ANDROID);
}

var config = require('./config.json');
var objectAssign = require('object-assign');
process.env = objectAssign(process.env, config.env);

var logger = require('./lib/testLogger')('UnitTest_app');
var testUtils = require('./lib/testUtils');
var ThaliMobile = require('thali/NextGeneration/thaliMobile');
var Promise = require('bluebird');

var utResult = false;

if (platform._isRealMobile) {
  Mobile('executeNativeTests').callNative(function (result) {
    logger.debug('Running unit tests');
    if (result) {
      if (!result.executed) {
        console.log('*Native tests were not executed*');

        utResult = false;
      } else {
        console.log('*Native tests were executed*');

        utResult = result.failed <= 0;
      }

      console.log('Total number of executed tests: ', result.total);
      console.log('Number of passed tests: ', result.passed);
      console.log('Number of failed tests: ', result.failed);
      console.log('Number of ignored tests: ', result.ignored);
      console.log('Total duration: ', result.duration);
    } else {
      console.log('*Native tests results are empty*');

      utResult = false;
    }
  });

  if (!utResult) {
    console.log('Failed to execute UT.');
    global.nativeUTFailed = true;

  }
} else {
  // We aren't on a device so we can't run those tests anyway
  utResult = true;
}

if (!utResult) {
  logger.debug('Failed to execute UT.');
  global.nativeUTFailed = true;
}

if (platform.isIOS) {
  // Disable node tests for iOS due to issue #1343
  console.log('****TEST_LOGGER:[PROCESS_ON_EXIT_SUCCESS]****');
  return;
}

// Issue #914
var networkTypes = [ThaliMobile.networkTypes.NATIVE];

ThaliMobile.getNetworkStatus()
.then(function (networkStatus) {
  var promiseList = [];
  if (networkStatus.wifi === 'off') {
    promiseList.push(testUtils.toggleWifi(true));
  }
  if (networkStatus.bluetooth === 'off') {
    promiseList.push(testUtils.toggleBluetooth(true));
  }
  Promise.all(promiseList)
  .then(function () {
    Mobile('GetDeviceName').callNative(function (name) {
      logger.debug('My device name is: %s', name);
      testUtils.setName(name);

      return networkTypes.reduce(function (sequence, networkType) {
        return sequence
          .then(function () {
            logger.debug('Running for ' + networkType + ' network type');
            global.NETWORK_TYPE = networkType;
            require('./runTests.js');
            return null;
          });
      }, Promise.resolve())
      .catch(function (error) {
        logger.error(error.message + '\n' + error.stack);
        return null;
      });
    });
  });
});

logger.debug('Unit Test app is loaded');
