var LogCallback;
var myName;
var os = require('os');
var tmp = require('tmp');

/**
 * Turn Bluetooth and WiFi either on or off
 * This is a NOOP on iOS and the desktop
 * @param {boolean} on - true to turn radios on and false to turn them off
 */
exports.toggleRadios = function(on) {

  if (typeof jxcore == 'undefined' || !jxcore.utils.OSInfo().isMobile || 
      !jxcore.utils.OSInfo().isAndroid) 
  {
    return;
  }

  if (jxcore.utils.OSInfo().isAndroid) {
    console.log('Toggling radios to ' + on);
    exports.toggleBluetooth(on, function () {
      exports.toggleWifi(on, function () {
        console.log('Radios toggled');
      });
    });
  } else {
    console.log("ERROR: toggleRadios called on unsupported platform");
  }
};

exports.toggleWifi = function (on, callback) {

  if (typeof jxcore == 'undefined') {
    callback();
    return;
  }

  Mobile.toggleWiFi(on, function (err) {
    if (err) {
      console.log('Could not toggle Wifi - ' + err);
    }
    callback();
  });
};

exports.toggleBluetooth = function (on, callback) {
  Mobile.toggleBluetooth(on, function (err) {
    if (err) {
      console.log('Could not toggle Bluetooth - ' + err);
    }
    callback();
  });
};

function isFunction(functionToCheck) {
  var getType = {};
  return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
}

/**
 * Log a message to the screen - only applies when running on Mobile. It assumes we are using our test framework
 * with our Cordova WebView who is setup to receive logging messages and display them.
 * @param {string} message
 */
exports.logMessageToScreen = function(message) {
  if (isFunction(LogCallback)) {
    LogCallback(message);
  } else {
    console.log("LogCallback not set !!!!");
  }
};


/**
 * Sets the myName value returned on the getMyName call used in Cordova from the test framework's Cordova WebView
 * @param name
 */
exports.setMyName = function(name) {
  myName = name;
};

if (typeof jxcore !== 'undefined' && jxcore.utils.OSInfo().isMobile) {
  Mobile('setLogCallback').registerAsync(function (callback) {
    LogCallback = callback;
  });

  Mobile('getMyName').registerAsync(function (callback) {
    callback(myName);
  });
} else {
  LogCallback = function(message) {
    console.log(message);
  }
}

/**
 * Returns the file path to the temporary directory that can be used by tests
 * to store data that does not have to be persisted between app restarts.
 * The temporary directory is removed when the process exits.
 */
var tmpObject = null;
exports.tmpDirectory = function () {
  if (tmpObject === null) {
    tmp.setGracefulCleanup();
    tmpObject = tmp.dirSync({
      unsafeCleanup: true
    });
  }
  return tmpObject.name;
};
