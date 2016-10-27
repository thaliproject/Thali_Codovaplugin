'use strict';

var config       = require('./config.json');
var spawn        = require('child_process').spawn;
var randomString = require('randomstring');
var objectAssign = require('object-assign');


var DEFAULT_INSTANCE_COUNT = 3;

var parseargv = require('minimist');
var argv = parseargv(process.argv.slice(2), {
  default: {
    test: 'UnitTest_app.js',
    filter: null,
    instanceCount: DEFAULT_INSTANCE_COUNT,
    serverLogs: true,
    instanceLogs: true,
    waitForInstance: false,
    showFailedLog: false
  },
  boolean: [
    'serverLogs',
    'instanceLogs',
    'waitForInstance',
    'showFailedLog'
  ],
  string: ['test', 'filter']
});

var spawnedInstanceCount = argv.instanceCount;
if (spawnedInstanceCount === -1) {
  spawnedInstanceCount = DEFAULT_INSTANCE_COUNT;
}
if (argv.waitForInstance) {
  spawnedInstanceCount = spawnedInstanceCount - 1;
}

var instanceLogs = {};

var logInstanceOutput = function (data, instanceId) {
  instanceLogs[instanceId] += data;

  if (argv.serverLogs && instanceId === 0) {
    jxcore.utils.console.log(data + '');
  } else if (argv.instanceLogs) {
    var colors = [
      'green',
      'cyan',
      'yellow',
      'magenta',
      'grey'
    ];

    // Use grey color for instances that don't have
    // own color in the colors array.
    var color = instanceId <= colors.length ?
      instanceId - 1 : colors.length-1;

    jxcore.utils.console.log(data + '', colors[color]);

  }
};

var setListeners = function (instance, instanceId) {
  instanceLogs[instanceId] = '';

  instance.stdout
  .on('data', function (data) {
    logInstanceOutput(data, instanceId);

    if (data.indexOf('PROCESS_ON_EXIT_') >= 0) {
      if (data.indexOf('PROCESS_ON_EXIT_FAILED') >= 0) {
        if (argv.showFailedLog) {
          console.log(instanceLogs[instanceId]);
        }
        shutdown(1);
      }
    } else if (data.indexOf('-== END ==-') >= 0) {
      if (instanceLogs[0].indexOf('RESULT: FAIL') >= 0) {
        console.log('TEST FAILED - SEE ABOVE FOR MORE DETAILS');
        shutdown(1);
      } else {
        shutdown(0);
      }
    }
  });

  instance.stderr
  .on('data', function (data) {
    logInstanceOutput(data, instanceId);
  });
  instance.on('error', function (err) {
    var error = 'Error : ' + err + '\n' + err.stack;
    logInstanceOutput(error, instanceId);
  });
  instance.on('exit', function (code, signal) {
    var codeAndSignal = 'Exit code: ' + code + '. Exit signal: ' + signal;
    logInstanceOutput(codeAndSignal, instanceId);
  });
};

var testServerConfiguration = {
  devices: {
    android: 0,
    ios: 0,
    desktop: argv.instanceCount
  },
  minDevices: {
    android: 0,
    ios: 0,
    desktop: 2
  },
  waiting_for_devices_timeout: 5 * 1000
};

var testEnv = objectAssign({}, process.env, config.env);
var testServerOpts = objectAssign({}, { env: testEnv });

var testServerInstance = spawn('node', ['../../TestServer/index.js',
  JSON.stringify(testServerConfiguration)], testServerOpts);
setListeners(testServerInstance, 0);

var instanceEnv = objectAssign({}, testEnv, {
  // We want to provide same random SSDP_NT for each test instance in group.
  SSDP_NT: randomString.generate({
    length: 'http://www.thaliproject.org/ssdp'.length
  })
});
var instanceOpts = objectAssign({}, { env: instanceEnv });

var testInstances = {};
var spawnTestInstance = function (instanceId) {
  var instanceArgs = [argv.test];
  if (argv.filter) {
    instanceArgs.push(argv.filter);
  }
  var testInstance = spawn('jx', instanceArgs, instanceOpts);
  setListeners(testInstance, instanceId);
  testInstances[instanceId] = testInstance;
};

for (var i = 1; i <= spawnedInstanceCount; i++) {
  spawnTestInstance(i);
}

var shutdown = function (code) {
  // A small delay so that instances have time to print
  // the test results.
  setTimeout(function () {
    Object.keys(testInstances).forEach(function (key) {
      testInstances[key].kill();
    });
    testServerInstance.kill();
    process.exit(code);
  }, 100);
};
