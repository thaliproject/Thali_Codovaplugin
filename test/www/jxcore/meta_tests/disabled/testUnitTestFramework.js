'use strict';

var UnitTestFramework = require('../../../TestServer/UnitTestFramework.js');
var TestDevice = require('../../../TestServer/TestDevice.js');
var tape = require('../lib/thaliTape');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var test = tape({
  setup: function (t) {
    t.end();
  },
  teardown: function (t) {
    console.log();
    t.end();
  }
});

var createTestDevice = function (socket, platform, index) {
  var tests = ['test-1', 'test-2'];
  return new TestDevice(
    socket,
    {
      name: platform + ' device ' + index,
      uuid: platform + '-uuid-' + index,
      os: platform,
      type: 'unittest',
      supportedHardware: true,
      tests: tests,
      btaddress: null
    }
  );
};

var amountOfDevices = 3;

var testConfig = {
  devices: {
    ios: amountOfDevices,
    android: amountOfDevices
  },
  honorCount: true,
  userConfig: {
    ios: {
      numDevices: amountOfDevices
    },
    android: {
      numDevices: amountOfDevices
    }
  }
};

var addSetupHandler = function (device, cb) {
  device.tests.forEach(function (test) {
    device._socket.on('setup_' + test, function (data) {
      device._socket.emit(util.format('setup_%s_confirmed', test), data);
      device._socket.emit(util.format('setup_%s_finished', test));
      cb();
    });
  });
  return device;
};


test('should get right number of setup emits', function (t) {
  var iosSetupCount = 0;
  var androidSetupCount = 0;
  var iosSetupDone = false;

  var mockSocket = new EventEmitter();
  var mockAndroidSocket = new EventEmitter();

  mockSocket.on('schedule', function (data) {
    mockSocket.emit('schedule_confirmed', data);
    mockSocket.emit('schedule_finished');
  });

  function addAndroidSetupHandlers(device) {
    return addSetupHandler(device, function () {
      androidSetupCount++;
      if (androidSetupCount === testConfig.devices.ios) {
        t.ok(true, 'received right amount of setup commands from the server');
        t.end();
      }
    });
  }

  function addIOSSetupHandlers(device) {
    return addSetupHandler(device, function () {
      iosSetupCount++;
      if (iosSetupCount === testConfig.devices.ios) {
        iosSetupDone = true;
        for (var i = 0; i < amountOfDevices; i++) {
          unitTestFramework.addDevice(
            addAndroidSetupHandlers(
              createTestDevice(mockAndroidSocket, 'android', i)));
        }
      }
    });
  }

  mockAndroidSocket.on('schedule', function (data) {
    mockAndroidSocket.emit('schedule_confirmed', data);
    mockAndroidSocket.emit('schedule_finished');
  });

  var unitTestFramework = new UnitTestFramework(testConfig);
  for (var i = 0; i < amountOfDevices; i++) {
    unitTestFramework.addDevice(
      addIOSSetupHandlers(createTestDevice(mockSocket, 'ios', i)));
  }
});

test('should discard surplus devices', function (t) {
  var unitTestFramework = new UnitTestFramework(testConfig);

  unitTestFramework.startTests = function (devices) {
    t.equals(unitTestFramework.platforms.ios.devices.length, amountOfDevices,
      'should have discarded the extra devices');
    t.end();
  };

  // Add two devices more than required in the test config
  for (var i = 0; i < amountOfDevices + 2; i++) {
    unitTestFramework.addDevice(
      addSetupHandler(createTestDevice(new EventEmitter(), 'ios', i))
    );
  }
});

test('should disqualify unsupported device', function (t) {
  var unitTestFramework = new UnitTestFramework(testConfig);
  unitTestFramework.startTests = function () {
    // NOOP
  };

  var mockSocket = new EventEmitter();
  mockSocket.on('disqualify', function () {
    mockSocket.emit('disqualify_confirmed');
    t.ok(true, 'disqualified unsupported device');
    t.end();
  });

  // Add one device less than required in the test config
  for (var i = 0; i < amountOfDevices - 1; i++) {
    unitTestFramework.addDevice(
      addSetupHandler(createTestDevice(new EventEmitter(), 'ios', i))
    );
  }

  unitTestFramework.addDevice(
    addSetupHandler(new TestDevice(
      mockSocket,
      {
        name: 'some-name',
        uuid: 'some-uuid',
        os: 'ios',
        type: 'unittest',
        supportedHardware: false, // this means the device doesn't have supported hardware
        tests: ['test'],
        btaddress: null
      }
    ))
  );
});
