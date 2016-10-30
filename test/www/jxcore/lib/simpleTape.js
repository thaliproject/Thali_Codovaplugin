'use strict';

// This implementation is based on https://github.com/daleharvey/wrapping-tape
// with support added to .only tests and introduing a begin function that
// needs to be called before tests start to run.

var tape = require('tape');
var Promise = require('lie');

var nextTestOnly = false;
var ignoreRemainingTests = false;

var tests = [];

module.exports = function (opts) {
  var addTest = function (name, expect, fun) {
    if (ignoreRemainingTests) {
      return;
    }

    if (nextTestOnly) {
      // Clear tests added so far
      tests = [];
      ignoreRemainingTests = true;
    }

    // Users can optionally specify the number of assertions expected
    // when they define the test
    if (!fun) {
      fun = expect;
      expect = null;
    }

    tests.push({
      name: name,
      expect: expect,
      fun: fun,
      opts: opts
    });
  };

  addTest.only = function (name, expect, fun) {
    nextTestOnly = true;
    addTest(name, expect, fun);
  };

  return addTest;
};

module.exports.begin = function () {
  var allSucceed = true;

  var handleResult = function (res) {
    allSucceed = allSucceed && res.ok;
  };

  tests.forEach(function (test, i) {
    if (test.opts.setup) {
      tape('setup', function (t) {
        t.on('result', handleResult);
        test.opts.setup.call(t, t);
      });
    }

    tape(test.name, function (t) {
      t.on('result', handleResult);
      if (test.expect !== null) {
        t.plan(test.expect);
      }
      test.fun.call(t, t);
    });

    if (test.opts.teardown) {
      tape('teardown', function (t) {
        t.on('result', handleResult);
        test.opts.teardown.call(t, t);
      });
    }
  });

  return new Promise (function (resolve, reject) {
    tape('summary', function (t) {
      if (allSucceed) {
        resolve();
      } else {
        reject('Some of TAP tests failed. See logs for more details.');
      }
      tests = [];
      t.end();
    });
  });
};
