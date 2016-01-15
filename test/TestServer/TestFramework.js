/* TestFramework - Base for classes that manage collections of devices and associated tests
 */

'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;

var logger = console;

function TestFramework(testConfig, userConfig, _logger) {

  if (_logger) {
    logger = _logger;
  }

  TestFramework.super_.call(this);

  this.devices = {};

  // testConfig - Config provided by the CI system. Tells how many devices are available
  // userConfig - Config provided by the user (via source). Tells us how many devices we need
  this.testConfig = testConfig;
  this.userConfig = userConfig;

  var self = this;

  // requiredDevices is the number of device of each platform 
  // we need to have seen before we'll start a test
  this.requiredDevices = {};

  // Populate first from the original testConfig which is
  // the number of devices the CI system think deployed succesfully
  Object.keys(this.testConfig.devices).forEach(function(platform) {
    self.requiredDevices[platform] = self.testConfig.devices[platform];
  });

  // .. then override with userConfig which may specify a smaller number
  // of devices
  Object.keys(this.userConfig).forEach(function(platform) {
    // -1 indicates to inherit from testConfig (i.e. all available)
    if (self.userConfig[platform].numDevices && self.userConfig[platform].numDevices !== -1) {
      self.requiredDevices[platform] = self.userConfig[platform].numDevices;
    }
  });
}

util.inherits(TestFramework, EventEmitter);

TestFramework.prototype.addDevice = function(device) {

  // this.devices = { 'ios' : [dev1, dev2], 'android' : [dev3, dev4] }
  if (!this.devices[device.platform]) {
    this.devices[device.platform] = [device];
  } else {

    // This is annoying.. android devices will randomly disconnect and reconnect during a run
    // When they do we need to patch the existing device record with the new socket by comparing
    // the uuid's. The new socket won't have any of the old socket's event handlers though..
    // .. so we need to transfer them from the old to the new socket.

    var existing = this.devices[device.platform].filter(function(d) {
      return (d.uuid == device.uuid);
    });

    if (existing.length) {
      logger.info(
        "Updating existing device: %s (%s)", existing[0].deviceName, existing[0].uuid
      );

      // Transfer the test data listener.. 99% of the time this will be the only one
      var listeners = existing[0].socket.listeners('test data');
      if (listeners.length) {
        device.socket.on("test data", listeners[0]);
      }

      existing[0].socket = device.socket;
      return;

    } else {
      // Straightforward add new device
      this.devices[device.platform].push(device);
    }
  }

  // See if we have enough devices of platform type to start a test run
  if (this.devices[device.platform].length === this.requiredDevices[device.platform]) {
    logger.info(
      "Required number of %s devices presented (%d)", 
      device.platform, this.requiredDevices[device.platform]
    );
    this.startTests(device.platform);
  } else if (this.devices[device.platform].length >= this.requiredDevices[device.platform]) {
    // Discard surplus devices..
    logger.info("Discarding surplus device: %s", device.deviceName);
    device.socket.emit("discard");
  }
}

TestFramework.prototype.removeDevice = function(device) {
  var i = this.devices[device.platform].indexOf(device);
  this.devices[device.platform].splice(i, 1);
  assert(this.devices[device.platform].indexOf(device) == -1);
}

module.exports = TestFramework;
