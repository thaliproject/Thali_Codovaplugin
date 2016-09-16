'use strict';

if (process.platform === 'android' || process.platform === 'ios') {

  var tape = require('../lib/thaliTape');
  var thaliMobileNativeWrapper = require('../node_modules/thali/NextGeneration/thaliMobileNativeWrapper');

  var callbackPeer;
  var timeout;

  var test = tape({
    setup: function (t) {
      timeout = setTimeout(function () {
        t.fail('No callback after calling registerToNative');
      }, 5000);
      t.end();
    },
    teardown: function (t) {
      thaliMobileNativeWrapper._registerToNative();
      t.end();
    }
  });

  test('onPeerLost calls jxcore', function (t) {
    setImmediate(function () {
      Mobile('peerAvailabilityChanged').registerToNative(function (peers) {
        //clearTimeout(timeOut);
        if (typeof peers.forEach !== 'function') {
          peers = [peers];
          t.fail('peers callback should be an array!');
        }

        peers.forEach(function (peer) {
          callbackPeer = peer;
        });
      });
    });

    setImmediate(function () {
      Mobile('testNativeMethod').callNative('onPeerLost', function (result) {
        clearTimeout(timeout);
        console.log(result.Testing_);
        setImmediate(function () {
          t.equal(callbackPeer.peerIdentifier, '11:22:33:22:11:00-0',
            'check if callback was fired by onPeerLost');
          t.notOk(callbackPeer.peerAvailable, 'check if peerAvailable is false');
        });
      });
    });
    t.end();
  });

  test('onPeerDiscovered calls jxcore', function (t) {
    setImmediate(function () {
      Mobile('peerAvailabilityChanged').registerToNative(function (peers) {

        if (typeof peers.forEach !== 'function') {
          peers = [peers];
          t.fail('peers callback should be an array!');
        }

        peers.forEach(function (peer) {
          callbackPeer = peer;
        });
      });
    });

    setImmediate(function () {
      Mobile('testNativeMethod').callNative('onPeerDiscovered', function (result) {
        clearTimeout(timeout);
        console.log(result.Testing_);
        setImmediate(function () {
          t.equal(callbackPeer.peerIdentifier, '33:44:55:44:33:22-0',
            'check if callback was fired by onPeerDiscovered');
          t.ok(callbackPeer.peerAvailable, 'check if peerAvailable is true');
        });
      });
    });
    t.end();
  });
}
