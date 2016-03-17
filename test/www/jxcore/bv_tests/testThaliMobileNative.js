'use strict';

var net = require('net');
var randomstring = require('randomstring');
var tape = require('../lib/thali-tape');
var logger = require('thali/thalilogger')('testThaliMobileNative');

var test = tape({
  setup: function (t) {
    t.end();
  },
  teardown: function (t) {
    // Need to call stops here to ensure we're in stopped state since Mobile is
    // a static singleton
    Mobile('stopListeningForAdvertisements').callNative(function (err) {
      t.notOk(
        err,
        'Should be able to call stopListeningForAdvertisments in teardown'
      );
      Mobile('stopAdvertisingAndListening').callNative(function (err) {
        t.notOk(
          err,
          'Should be able to call stopAdvertisingAndListening in teardown'
        );
        t.end();
      });
    });
  }
});

test('Can call start/stopListeningForAdvertisements', function (t) {
  Mobile('startListeningForAdvertisements').callNative(function (err) {
    t.notOk(err, 'Can call startListeningForAdvertisements without error');
    Mobile('stopListeningForAdvertisements').callNative(function (err) {
      t.notOk(err, 'Can call stopListeningForAdvertisements without error');
      t.end();
    });
  });
});

test('Calling startListeningForAdvertisements twice is NOT an error',
function (t) {
  Mobile('startListeningForAdvertisements').callNative(function (err) {
    t.notOk(err, 'Can call startListeningForAdvertisements without error');
    Mobile('startListeningForAdvertisements').callNative(function (err) {
      t.notOk(
        err,
        'Can call startListeningForAdvertisements twice without error'
      );
      t.end();
    });
  });
});

test('Can call start/stopUpdateAdvertisingAndListening', function (t) {
  Mobile('startUpdateAdvertisingAndListening').callNative(4242, function (err) {
    t.notOk(err, 'Can call startUpdateAdvertisingAndListening without error');
    Mobile('stopAdvertisingAndListening').callNative(function (err) {
      t.notOk(
        err, 'Can call stopAdvertisingAndListening without error'
      );
      t.end();
    });
  });
});

test('Calling startUpdateAdvertisingAndListening twice is NOT an error',
function (t) {
  Mobile('startUpdateAdvertisingAndListening').callNative(4242, function (err) {
    t.notOk(err, 'Can call startUpdateAdvertisingAndListening without error');
    Mobile('startUpdateAdvertisingAndListening').callNative(4243,
    function (err) {
      t.notOk(
        err,
        'Can call startUpdateAdvertisingAndListening twice without error'
      );
      t.end();
    });
  });
});

if (!tape.coordinated) {
  return;
}

test('peerAvailabilityChange is called', function (t) {

  var complete = false;

  Mobile('peerAvailabilityChanged').registerToNative(function (peers) {

    if (!complete)
    {
      t.ok(peers instanceof Array, 'peers must be an array');
      t.ok(peers.length !== 0, 'peers must not be zero-length');

      t.ok(peers[0].hasOwnProperty('peerIdentifier'),
        'peer must have peerIdentifier');
      t.ok(typeof peers[0].peerIdentifier === 'string',
        'peerIdentifier must be a string');
      
      t.ok(peers[0].hasOwnProperty('peerAvailable'),
        'peer must have peerAvailable');
      t.ok(peers[0].hasOwnProperty('pleaseConnect'),
        'peer must have pleaseConnect');

      complete = true;
      t.end();
    }
  });

  Mobile('startUpdateAdvertisingAndListening').callNative(4242, function (err) {
    t.notOk(err, 'Can call startUpdateAdvertisingAndListeningwithout error');
    Mobile('startListeningForAdvertisements').callNative(function (err) {
      t.notOk(err, 'Can call startListeningForAdvertisements without error');
    });
  });
});

function connectToPeer(peer, retries, successCb, failureCb) {

  var TIME_BETWEEN_RETRIES = 3000;

  retries--;
  Mobile('connect').callNative(peer.peerIdentifier, function (err, connection) {

    if (err == null) {
      // Connected successfully..
      successCb(err, connection);
    } else {
      logger.info('Connect returned an error: ' + err);
      // Retry a failed connection..
      if (retries > 0) {
        logger.info('Scheduling a connect retry - retries left: ' + retries);
        setTimeout(function () {
          connectToPeer(peer, retries, successCb, failureCb);
        }, TIME_BETWEEN_RETRIES);
      } else {
        if (failureCb) {
          logger.warn('Too many connect retries!');
          // Exceeded retries..
          failureCb(err, connection);
        }
      }
    }
  });
}

test('Can connect to a remote peer', function (t) {

  var connecting = false;

  var echoServer = net.createServer(function (socket) {
    socket.pipe(socket);
  });

  function onConnectSuccess(err, connection) {

    // Called if we successfully connecto to a peer
    connection = JSON.parse(connection);
    logger.info(connection);

    t.ok(connection.hasOwnProperty('listeningPort'),
      'Must have listeningPort');
    t.ok(typeof connection.listeningPort === 'number',
      'listeningPort must be a number');
    t.ok(connection.hasOwnProperty('clientPort'),
      'Connection must have clientPort');
    t.ok(typeof connection.clientPort === 'number',
      'clientPort must be a number');
    t.ok(connection.hasOwnProperty('serverPort'),
      'Connection must have serverPort');
    t.ok(typeof connection.serverPort === 'number',
      'serverPort must be a number');

    if (connection.listeningPort !== 0)
    {
      // Forward connection
      t.ok(connection.clientPort === 0,
        'forward connection must have clientPort == 0');
      t.ok(connection.serverPort === 0,
        'forward connectionmust have serverPort == 0');
    }
    else
    {
      // Reverse connection
      t.ok(connection.clientPort !== 0,
        'reverse connection must have clientPort != 0');
      t.ok(connection.serverPort !== 0,
        'reverse connection must have serverPort != 0');
    }

    t.end();
  }

  function onConnectFailure () {
    // NOOP
  }

  echoServer.listen(0, function () {

    var applicationPort = echoServer.address().port;

    Mobile('peerAvailabilityChanged').registerToNative(function (peers) {
      logger.info('Received peerAvailabilityChanged with peers: ' +
        JSON.stringify(peers)
      );
      peers.forEach(function (peer) {
        if (peer.peerAvailable && !connecting) {
          connecting = true;
          var RETRIES = 10;
          connectToPeer(peer, RETRIES, onConnectSuccess, onConnectFailure);
        }
      });
    });

    Mobile('startUpdateAdvertisingAndListening').callNative(applicationPort,
    function (err) {
      t.notOk(err, 'Can call startUpdateAdvertisingAndListening without error');
      Mobile('startListeningForAdvertisements').callNative(function (err) {
        t.notOk(err, 'Can call startListeningForAdvertisements without error');
      });
    });
  });
});

test('Can shift large amounts of data', function (t) {

  var connecting = false;

  var sockets = {};
  var echoServer = net.createServer(function (socket) {
    socket.on('data', function (data) {
      socket.write(data);
    });
    socket.on('end', socket.end);
    socket.on('error', function (error) {
      logger.info('Error on echo server socket: ' + error);
      t.fail();
    });
    sockets[socket.remotePort] = socket;
  });

  var dataSize = 4096;
  var toSend = randomstring.generate(dataSize);

  function shiftData(sock, reverseConnection) {

    sock.on('error', function (error) {
      logger.info('Error on client socket: ' + error);
      t.fail();
    });

    var toRecv = '';

    if (reverseConnection) {

      // Since this is a reverse connection, the socket we've been handed has
      // already been accepted by our server and there's a client on the other
      // end already sending data.
      // Without multiplex support we can't both talk at the same time so
      // wait for the other side to finish before sending our data.

      var totalRecvd = 0;
      sock.on('data', function (data) {

        logger.info('reverseData');
        totalRecvd += data.length;

        if (totalRecvd === dataSize) {
          logger.info('reverseSend');
          // We've seen all the remote's data, send our own
          sock.write(toSend);
        }

        if (totalRecvd > dataSize) {
          // This should now be our own data echoing back
          toRecv += data.toString(); 
        } 

        if (toRecv.length === dataSize) {
          // Should have an exact copy of what we sent
          t.ok(toRecv === toSend, 'received should match sent reverse');
          t.end();
        }
      });
    }
    else {
    
      // This one's more straightforward.. we're going to send first,
      // read back our echo and then echo out any extra data

      var done = false;
      sock.on('data', function (data) {

        logger.info('forwardData');

        var remaining = dataSize - toRecv.length;

        if (remaining >= data.length) {
          toRecv += data.toString();
          data = data.slice(0, 0);
        }
        else {
          toRecv += data.toString('utf8', 0, remaining);
          data = data.slice(remaining);
        }

        if (toRecv.length === dataSize) {
          if (!done) {
            done = true;
            t.ok(toSend === toRecv, 'received should match sent forward');
            t.end();
          }
          if (data.length) {
            sock.write(data);
          }
        }
      });

      logger.info('forwardSend');
      sock.write(toSend);
    }
  }

  function onConnectSuccess(err, connection) {

    var client = null;

    // We're happy here if we make a connection to anyone
    connection = JSON.parse(connection);
    logger.info(connection);

    if (connection.listeningPort) {
      logger.info('Forward connection');
      // We made a forward connection
      client = net.connect(connection.listeningPort, function () {
        shiftData(client, false);
      });
    } else {
      logger.info('Reverse connection');
      // We made a reverse connection
      client = sockets[connection.clientPort];
      shiftData(client, true);
    }
  }

  function onConnectFailure() {
    // NOOP
  }

  Mobile('peerAvailabilityChanged').registerToNative(function (peers) {
    peers.forEach(function (peer) {
      if (peer.peerAvailable && !connecting) {
        connecting = true;
        var RETRIES = 10;
        connectToPeer(peer, RETRIES, onConnectSuccess, onConnectFailure);
      }
    });
  });

  echoServer.listen(0, function () {

    var applicationPort = echoServer.address().port;

    Mobile('startUpdateAdvertisingAndListening').callNative(applicationPort,
    function (err) {
      t.notOk(err, 'Can call startUpdateAdvertisingAndListening without error');
      Mobile('startListeningForAdvertisements').callNative(function (err) {
        t.notOk(err, 'Can call startListeningForAdvertisements without error');
      });
    });
  });
});
