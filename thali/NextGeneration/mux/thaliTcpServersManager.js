'use strict';

var util = require('util');
var Promise = require('lie');
var EventEmitter = require('events').EventEmitter;
var createNativeListener = require('./createNativeListener');
var createPeerListener = require('./createPeerListener');

/** @module TCPServersManager */

/**
 * @classdesc This is where we manage creating multiplex objects. For all
 * intents and purposes this file should be treated as part of {@link
 * module:thaliMobileNativeWrapper}. We have broken this functionality out here
 * in order to make the code more maintainable and easier to follow.
 *
 * When dealing with incoming connections this code creates a multiplex object
 * to handle de-multiplexing the incoming connections and in the iOS case to
 * also send TCP/IP connections down the incoming connection (reverse the
 * polarity as it were).
 *
 * When dealing with discovered peers we like to advertise a port that the
 * Thali Application can connect to in order to talk to that peer. But for perf
 * reasons that port is typically not connected to anything at the native layer
 * (with the exception of a lexically smaller peer) until someone connects to
 * the port. The reason for this design (thanks Ville!) is to make non-TCP and
 * TCP peers look the same. There is an address (in this case 127.0.0.1) and a
 * port and you connect and there you go. This file defines all the magic needed
 * to create the illusion that a non-TCP peer is actually available over TCP.
 *
 * There are three different scenarios where multiplex objects can get
 * created:
 *
 * Android
 * - We get an incoming connection from the native layer to the portNumber we
 * submitted to startUpdateAdvertisingAndListening
 *  - We create a mux that pipes to the incoming TCP/IP connection.
 * - We get a peerAvailabilityChanged Event
 *  - We create a local listener and advertise nonTCPPeerAvailabilityChanged.
 *  When we get a connection to that listener then we call native connect,
 *  create a connection to the native connect port, hook the mux to that
 *  connection on one end and the incoming listener to the mux on the other end.
 *
 * iOS - Lexically Smaller Peer
 * - We get an incoming connection from the native layer to the portNumber we
 * submitted to startUpdateAdvertisingAndListening
 *  - We create a mux that pipes to the incoming TCP/IP connection. We keep
 *  track of this mux because we might need it in the next entry. Remember, we
 *  don't know which peer made the incoming connection.
 * - We get a peerAvailabilityChanged Event
 *  - Because we are lexically smaller this event will have pleaseConnect set
 *  to false. So we create a port and advertise it on
 *  nonTCPPeerAvailabilityChanged. When we get a connection we call connect. If
 *  there is already an incoming connection then the connect will return with
 *  the clientPort/serverPort and we will re-use the existing mux If there is no
 *  existing incoming connection then the system will wait to trigger the
 *  lexically larger peer to create it and once it is created and properly
 *  terminated (per the previous section) then we will find the mux via
 *  clientPort/ServerPort.
 *
 * iOS - Lexically Larger Peer
 * - We get an incoming connection from the native layer to the portNumber we
 * submitted to startUpdateAdvertisingAndListening
 *  - It isn't possible.
 * - We get a peerAvailabilityChanged Event
 *  - If the peerAvailabilityChanged Event has pleaseConnect set to true then
 *  baring any limitation on available resources we should immediately issue a
 *  connect and hook in the mux to it configured to handling incoming
 *  connections and then create a TCP listener and have it use createStream with
 *  the mux for any incoming connections. Obviously if we already have a
 *  connection to the identified peer then we can ignore the pleaseConnect
 *  value.
 *  - If the peerAvailabilityChanged Event has pleaseConnect set to false
 *  then we will set up a TCP listener and advertise the port but we won't
 *  create the mux or call connect until the first connection to the TCP
 *  listener comes in.
 *
 *  We have two basic kinds of listeners. One type is for incoming
 *  connections from remote peers. In that case we will have a TCP connection
 *  from the native layer connecting to us which we will then connect to a
 *  multiplex object. The other listener is for connections from a Thali App to
 *  a remote peer. In that case we will create a TCP connection to a native
 *  listener and hook our TCP connection into a multiplex object. And of course
 *  with the iOS situation sometimes it all gets mixed up.
 *
 *  But the point is that each listener has at its root a TCP connection
 *  either going out to or coming in from the native layer. Because keeping
 *  native connections open eats battery (although this is probably a much less
 *  significant issue with iOS due to its UDP based design) we don't want to let
 *  connections hang open unused. This is why we put a timeout on the TCP
 *  connection under the multiplex. That connection sees all traffic in both
 *  directions (e.g. even in the iOS case where we mux connections both ways)
 *  and so it knows if anything is happening. If all is quiet then it knows it
 *  can kill the connection.
 *
 *  We also need to deal with cleaning things up when they go wrong.
 *  Typically we will focus the cleanup code on the multiplex object. It will
 *  first close the TCP connections with the Thali app then the multiplex
 *  streams connected to those TCP connections then it will close the listener
 *  and any native connections before closing itself.
 *
 *  Separately it is possible for individual multiplexed TCP connections to
 *  die or the individual streams they are connected to can die. This only
 *  requires local clean up. We just have to be smart so we don't try to close
 *  things that are already closed. So when a TCP connection gets a closed event
 *  it has to detect if it was closed by the underlying multiplex stream or by a
 *  TCP level error. If it was closed by the multiplex stream then it shouldn't
 *  call close on the multiplex stream it is paired with otherwise it should.
 *  The same logic applies when an individual stream belonging to multiplex
 *  object gets closed. Was it closed by its paired TCP connection? If so, then
 *  it's done. Otherwise it needs to close that connection.
 *
 * @public
 * @constructor
 * @param {number} routerPort The port that the system is hosting the local
 * router instance for the Thali Application.
 * @fires event:routerPortConnectionFailed
 * @fires event:failedConnection
 * @fires event:incomingConnectionState
 */
function ThaliTcpServersManager(routerPort) {

  this._state = this.TCPServersManagerStates.INITIALIZED;

  // The single native server created by _createNativeListener
  this._nativeServer = null;

  // The set of peer servers created by createPeerListener
  this._peerServers = {};

  // See note in createPeerListener
  this._pendingReverseConnections = {};

  // The port on which we expect the application to be
  // listening
  this._routerPort = routerPort;
}

util.inherits(ThaliTcpServersManager, EventEmitter);

/**
 * This method will call
 * {@link module:tcpServersManager~TCPServersManager#_createNativeListener}
 * using the routerPort from the constructor and record the returned port.
 *
 * This method is idempotent and so MUST be able to be called multiple times
 * in a row without changing state.
 *
 * If called successfully then the object is in the start state.
 *
 * If this method is called after a call to
 * {@link tcpServersManager~TCPServersManager#stop} then a "We are stopped!"
 * error MUST be thrown.
 *
 * @public
 * @returns {Promise<number|Error>} Returns the port to be passed to {@link
 * external:"Mobile('startUpdateAdvertisingAndListening')".ca
 * llNative} when the system is ready to receive external incoming connections.
 */
ThaliTcpServersManager.prototype.start = function () {
  var self = this;
  function _do(resolve, reject) {
    switch (self._state) {
      case self.TCPServersManagerStates.STOPPED: {
        return reject('We are stopped!');
      }
      case self.TCPServersManagerStates.STARTED: {
        return resolve(self._nativeServer.address().port);
      }
      case self.TCPServersManagerStates.INITIALIZED: {
        break;
      }
      default: {
        return reject('start - Unsupported TCPServersManagerStates value - ' +
          self._state);
      }
    }

    self._state = self.TCPServersManagerStates.STARTED;
    self._createNativeListener()
    .then(function (localPort) {
      resolve(localPort);
    })
    .catch(function (err) {
      reject(err);
    });
  }
  return new Promise(_do);
};

// jscs:exclude jsDoc
/**
 * This will cause destroy to be called on the TCP server created by {@link
 * module:tcpServersManager._createNativeListener} and then on all the TCP
 * servers created by {@link
 * module:tcpServersManager.connectToPeerViaNativeLayer}.
 *
 * This method is idempotent and so MUST be able to be called multiple times in
 * a row without changing state.
 *
 * If this method is called before calling start then a "Call Start!" Error MUST
 * be returned.
 *
 * Once called the object is in the stop state and cannot leave it. To start
 * again this object must be disposed and a new one created.
 *
 * @public
 * @returns {Promise<?Error>}
 */
// jscs:include jsDoc
ThaliTcpServersManager.prototype.stop = function () {
  var self = this;
  switch (self._state) {
    case self.TCPServersManagerStates.STOPPED: {
      return Promise.resolve();
    }
    case self.TCPServersManagerStates.INITIALIZED: {
      return Promise.reject(new Error('Call Start!'));
    }
    case self.TCPServersManagerStates.STARTED: {
      break;
    }
    default: {
      return Promise.reject(
        new Error('stop - Unsupported TCPServersManagerStates value - ' +
          self._state));
    }
  }

  self._state = self.TCPServersManagerStates.STOPPED;

  var promisesArray = [];

  if (self._nativeServer) {
    promisesArray.push(self._nativeServer.closeAllPromise()
      .then(function () {
        self._nativeServer = null;
      }));
  }
  for (var peerIdentifier in self._peerServers) {
    if (self._peerServers.hasOwnProperty(peerIdentifier)) {
      self._peerServers[peerIdentifier].server._closing = true;
      promisesArray.push(
        self._peerServers[peerIdentifier].server.closeAllPromise());
    }
  }
  self._peerServers = {};

  return Promise.all(promisesArray);
};

/**
 * @private
 * @returns {Promise<number|Error>} The port that the mux is listening on for
 * connections from the native layer or an Error object.
 */
ThaliTcpServersManager.prototype._createNativeListener = function () {
  return createNativeListener(this);
};

/**
 * @public
 * @param {string} peerIdentifier
 * @param {boolean} [pleaseConnect] If set to true this indicates that a
 * lexically smaller peer asked for a connection so the lexically larger peer
 * (the local device) will immediately call {@link
 * external:"Mobile('connect')".callNative} to create a connection. If false
 * then the call to {@link external:"Mobile('connect')".callNative} will only
 * happen on the first incoming connection to the TCP server.
 * @returns {Promise<number|Error>}
 */
ThaliTcpServersManager.prototype.createPeerListener = function (peerIdentifier,
                                                                pleaseConnect) {
  return createPeerListener(this, peerIdentifier, pleaseConnect);
};

/**
 * Terminates an incoming connection with the associated incomingConnectionId.
 *
 * It is NOT an error to terminate a connection that on longer exists.
 *
 * This method MUST be idempotent so multiple calls with the same value MUST NOT
 * cause an error or a state change.
 *
 * @param {Object} incomingConnectionId
 * @returns {Promise<?error>}
 */
ThaliTcpServersManager.prototype.terminateIncomingConnection =
  function (incomingConnectionId) {
    return new Promise(function (resolve) {
      if (incomingConnectionId.destroyed) {
        return resolve();
      }
      incomingConnectionId.once('close', function () {
        resolve();
      });
      incomingConnectionId.destroy();
    });
  };

/**
 * Terminates a server listening for connections to be sent to a remote device.
 *
 * It is NOT an error to terminate a listener that has already been terminated.
 *
 * This method MUST be idempotent so multiple calls with the same value MUST NOT
 * cause an error or a state change.
 *
 * @param {string} peerIdentifier
 * @param {number} port
 * @returns {Promise<?error>}
 */
ThaliTcpServersManager.prototype.terminateOutgoingConnection =
  function (peerIdentifier, port) {

  };

/**
 * Notifies the listener of a failed connection attempt. This is mostly used to
 * determine when we have hit the local maximum connection limit but it's used
 * any time there is a connection error since the only other hint that a
 * connection is failed is that the TCP/IP connection to the 127.0.0.1 port will
 * fail.
 *
 * In the case that this error is generated from a callback to the
 * {@link external:"Mobile('connect')".callNative} method then the error
 * returned by connect MUST be returned in this event.
 *
 * @public
 * @event failedConnection
 * @property {Error} error
 * @property {string} peerIdentifier
 */

/**
 * Notifies the listener that an attempt to connect to routerPort failed.
 *
 * @public
 * @event routerPortConnectionFailed
 * @property {Error} error
 * @property {number} routerPort
 */

ThaliTcpServersManager.prototype.ROUTER_PORT_CONNECTION_FAILED =
  'routerPortConnectionFailed';

/**
 * @readonly
 * @public
 * @enum {string}
 */
ThaliTcpServersManager.prototype.incomingConnectionState = {
  'CONNECTED': 'connected',
  'DISCONNECTED': 'disconnected'
};

/**
 * Notifies the listener when a connection is formed or cut. We use the
 * incomingConnectionId rather than say client TCP ports to prevent confusion in
 * the (unlikely) case that the same port is used twice.
 *
 * @public
 * @event incomingConnectionState
 * @property {Object} incomingConnectionId Uniquely identifies an incoming
 * connection. The only legal operation on this object is an equality check.
 * Otherwise the object must be treated as opaque.
 * @property
 * {module:TCPServersManager~TCPServersManager.incomingConnectionState} state
 * Indicates if the connection has been established or cut.
 */

ThaliTcpServersManager.prototype.INCOMING_CONNECTION_STATE =
  'incomingConnectionState';

/**
 * Defines the state TCPServersManager can be in
 * @readonly
 * @enum {string}
 */
ThaliTcpServersManager.prototype.TCPServersManagerStates = {
  /** Neither start nor stop have been called yet **/
  INITIALIZED: 'initialized',
  /** Start has been called, but not stop **/
  STARTED: 'started',
  /** Stop has been called **/
  STOPPED: 'stopped'
};

module.exports = ThaliTcpServersManager;
