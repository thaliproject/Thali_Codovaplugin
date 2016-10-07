'use strict';

var util     = require('util');
var format   = util.format;
var inherits = util.inherits;

var net          = require('net');
var objectAssign = require('object-assign');
var uuidValidate = require('uuid-validate');
var assert       = require('assert');
var tape         = require('tape-catch');
var EventEmitter = require('events').EventEmitter;

var asserts = require('./utils/asserts');
var Promise = require('./utils/Promise');

var testUtils     = require('./testUtils');
var serverAddress = require('../server-address');
var ServerClient  = require('./ServerClient');

var logger = require('./testLogger')('CoordinatedClient');


function CoordinatedClient(tests, uuid, platform, version, hasRequiredHardware, nativeUTFailed) {
  asserts.isArray(tests);
  tests.forEach(function (test) {
    asserts.isString(test.name);
    asserts.isFunction(test.fun);
    asserts.isFunction(test.options.setup);
    asserts.isFunction(test.options.teardown);
    asserts.isNumber(test.options.setupTimeout);
    asserts.isNumber(test.options.testTimeout);
    asserts.isNumber(test.options.teardownTimeout);
    asserts.isNumber(test.options.emitRetryCount);
    asserts.isNumber(test.options.emitRetryTimeout);
  });
  assert(
    tests.length > 0,
    'we should have at least one test'
  );

  this._tests = tests.slice();
  this._testNames = this._tests.map(function (test) {
    return test.name;
  });

  asserts.isString(uuid);
  this._uuid = uuid;

  asserts.isString(platform);
  this._platform = platform;

  asserts.exists(version);
  this._version = version;

  asserts.isBool(hasRequiredHardware);
  this._hasRequiredHardware = hasRequiredHardware;

  asserts.isBool(nativeUTFailed);
  this._nativeUTFailed = nativeUTFailed;

  this._state = CoordinatedClient.states.created;

  this._serverClient = new ServerClient(serverAddress, 3000, {
    reconnectionAttempts: 15,
    reconnectionDelay:    200,
    emitTimeout:          2 * 60 * 1000
  });
  this._bind();
}

inherits(CoordinatedClient, EventEmitter);

CoordinatedClient.states = {
  created:   'created',
  completed: 'completed'
};

CoordinatedClient.prototype._bind = function () {
  this._serverClient
  .on('connect', this._connect.bind(this))
  .on('error',   this._error.bind(this))

  .once('schedule',   this._schedule.bind(this))
  .on  ('discard',    this._discard.bind(this))
  .on  ('disqualify', this._disqualify.bind(this))
  .on  ('close',      this._disconnect.bind(this))
  .on  ('error',      this._error.bind(this))
  .once('complete',   this._complete.bind(this))

  .connect();
}

// Both 'connect' and 'reconnect' will be here.
CoordinatedClient.prototype._connect = function () {
  logger.debug('connected to the test server');

  this._serverClient.emitData('present', {
    name:    testUtils.getName(),
    uuid:    this._uuid,
    type:    'unittest',
    tests:   this._testNames,
    os:      this._platform,
    version: this._version,
    hasRequiredHardware: this._hasRequiredHardware,
    nativeUTFailed: this._nativeUTFailed
  });
}

CoordinatedClient.prototype._schedule = function (data) {
  var self = this;

  var testNames = CoordinatedClient.getData(data);
  asserts.arrayEquals(testNames, this._testNames);

  this._serverClient.emitData('schedule_confirmed', data)
  .then(function () {
    var promises = self._tests.map(function (test) {
      return self._scheduleTest(test);
    });
    return Promise.all(promises);
  })
  .catch(function (error) {
    logger.error(
      'unexpected error: \'%s\', stack: \'%s\'',
      error.toString(), error.stack
    );
    self._failed(error);
  });
}

CoordinatedClient.prototype._discard = function (data) {
  var self = this;

  this._serverClient.emitData('discard_confirmed', data)
  .then(function () {
    logger.debug('device discarded as surplus from the test server');
  });

  // We are waiting for 'disconnect' event.
  self._state = CoordinatedClient.states.completed;
}

CoordinatedClient.prototype._disqualify = function (data) {
  var self = this;

  this._serverClient.emitData('disqualify_confirmed', data)
  .then(function () {
    if (data) {
      var errorText = CoordinatedClient.getData(data);
      logger.error('device disqualified from the test server, reason: \'%s\'', errorText);
      self._failed(new Error(
        'Test client failed: ' + errorText
      ));
      return;
    }
    logger.debug('device disqualified from the test server');

    return testUtils.returnsValidNetworkStatus()
    .then(function (validStatus) {
      if (!validStatus) {
        self._failed(new Error(
          'test client failed, network status is not valid'
        ));
      }
    });
  });

  // We are waiting for 'disconnect' event.
  self._state = CoordinatedClient.states.completed;
}

CoordinatedClient.prototype._disconnect = function () {
  if (this._state === CoordinatedClient.states.completed) {
    logger.debug('test client disconnected');
    this._succeed();
  } else {
    // Just log the error since socket.io will try to reconnect.
    logger.debug('device disconnected from the test server');
  }
}

CoordinatedClient.prototype._error = function (error) {
  logger.error(
    'unexpected error: \'%s\', stack: \'%s\'',
    error.toString(), error.stack
  );
  this._failed(error);
}

CoordinatedClient.prototype._complete = function (data) {
  var self = this;

  this._serverClient.emitData('complete_confirmed', data)
  .then(function () {
    logger.debug('all tests completed');
  });

  // We are waiting for 'disconnect' event.
  self._state = CoordinatedClient.states.completed;
}

CoordinatedClient.prototype._succeed = function () {
  logger.debug('test client succeed');
  this._serverClient.close();
  this.emit('finished');
}

CoordinatedClient.prototype._failed = function (error) {
  logger.debug('test client failed');
  this._serverClient.close();
  this.emit('finished', error);
}

CoordinatedClient.prototype._scheduleTest = function (test) {
  var self = this;

  function runEvent (event) {
    return new Promise(function (resolve, reject) {
      logger.debug('we are waiting for event: \'%s\'', event);
      self._serverClient.once(event, function (data) {
        logger.debug('we are emitting data for event: \'%s\', data: \'%s\'', event + '_confirmed', JSON.stringify(data));
        self._serverClient.emitData(event + '_confirmed', data, test.options)
        .then(function () {
          resolve(CoordinatedClient.getData(data));
        })
        .catch(reject);
      });
    });
  }

  function skipEvent (tape, event, timeout) {
    return runEvent(event)
    .then(function () {
      return new Promise(function (resolve, reject) {
        tape.once('end', function () {
          logger.debug('we are emitting data for event: \'%s\', data: \'%s\'', event + '_skipped', undefined);
          self._serverClient.emitData(event + '_skipped', undefined, test.options)
          .then(resolve)
          .catch(reject);
        });
        tape.end();
      });
    })
    .timeout(
      timeout,
      format('timeout exceed while skipping test: \'%s\'', test.name)
    );
  }

  function processEvent(tape, event, fun, timeout) {
    return runEvent(event)
    .then(function (parsedData) {
      // Only for testing purposes.
      if (parsedData) {
        tape.participants = parsedData;
      }

      var resultHandler;
      var endHandler;

      return new Promise(function (resolve, reject) {
        // 'end' can be called without 'result', so success is true by default.
        // We can receive 'result' many times.
        // For example each 'tape.ok' will provide a 'result'.
        var success = true;
        resultHandler = function (result) {
          if (!result.ok) {
            success = false;
          }
        }
        tape.on('result', resultHandler);

        endHandler = function () {
          tape.removeListener('result', resultHandler);
          resultHandler = null;
          endHandler    = null;

          logger.debug('we are emitting data for event: \'%s\', data: \'%s\'', event + '_finished', JSON.stringify({
            success: success,
            data:    tape.data
          }));
          self._serverClient.emitData(
            event + '_finished',
            {
              success: success,
              data:    tape.data
            },
            test.options
          )
          .then(function () {
            if (success) {
              resolve(parsedData);
            } else {
              var error = format('test failed, name: \'%s\'', test.name);
              logger.error(error);
              reject(new Error(error));
            }
          })
          .catch(reject);
        }
        tape.once('end', endHandler);

        fun(tape);
      })
      .finally(function () {
        if (resultHandler) {
          tape.removeListener('result', resultHandler);
        }
        if (endHandler) {
          tape.removeListener('end', endHandler);
        }
      });
    })
    .timeout(
      timeout,
      format('timeout exceed while processing test: \'%s\'', test.name)
    );
  }

  function sync (tape, timeout) {
    // returns something like 'at file:lineNumber'.
    function getCaller (level) {
      var traces = (new Error()).stack.split('\n');
      assert(
        traces.length > level,
        format('stack should have a least %d lines', level + 1)
      );
      return traces[level].trim();
    }
    var callerId = getCaller(3);

    logger.debug('we are emitting data for event: \'%s\', data: \'%s\'', 'sync', callerId);
    return self._serverClient.emitData('sync', callerId, test.options)
    .then(function () {
      return runEvent('syncFinished');
    })
    .timeout(
      timeout,
      format('timeout exceed while syncing test: \'%s\'', test.name)
    );
  }

  return new Promise(function (resolve, reject) {
    tape('setup', function (tape) {
      tape.sync = sync.bind(undefined, tape, test.options.setupTimeout);

      processEvent(tape, 'setup_' + test.name, test.options.setup, test.options.setupTimeout)
      .catch(reject);
    });

    tape(test.name, function (tape) {
      tape.sync = sync.bind(undefined, tape, test.options.testTimeout);

      Promise.try(function () {
        if (test.canBeSkipped) {
          return test.canBeSkipped();
        } else {
          return false;
        }
      })
      .then(function (canBeSkipped) {
        if (canBeSkipped) {
          logger.info('test was skipped, name: \'%s\'', test.name);
          return skipEvent(tape, 'run_' + test.name, test.options.testTimeout);
        } else {
          return processEvent(tape, 'run_' + test.name, test.fun, test.options.testTimeout);
        }
      })
      .catch(reject);
    });

    tape('teardown', function (tape) {
      tape.sync = sync.bind(undefined, tape, test.options.teardownTimeout);

      processEvent(tape, 'teardown_' + test.name, test.options.teardown, test.options.teardownTimeout)
      // We should exit after test teardown.
      .then(resolve)
      .catch(reject);
    });
  });
}

// We should remove prefix (uuid.v4) from data.
CoordinatedClient.getData = function (data) {
  assert(
    uuidValidate(data.uuid, 4),
    'we should have a valid uuid.v4'
  );
  return data.content;
}

module.exports = CoordinatedClient;
