"use strict";

var Promise = require("lie");
var ThaliWifiInfrastructure = require("ThaliWifiInfrastructure");


/** @module WifiBasedNativeMock */

/**
 * @file
 *
 * This is a mock of {@link module:thaliMobileNative}. It is intended to replicate all the capabilities of
 * {@link module:thaliMobileNative} so that we can build and test code intended to use {@link module:thaliMobileNative}
 * but on the desktop.
 *
 * We are intentionally replicating the lowest layer of the stack in order to to be able to test on the desktop
 * all the layers on top of it. This includes emulating behaviors unique to iOS and Android.
 *
 * For testing purposes if callNative or registerToNative do not get all the parameters they were expecting then
 * a "Bad Arguments" exception MUST be thrown.
 */

MobileCallInstance.prototype.wifiBasedNativeMock = null;
MobileCallInstance.prototype.mobileMethodName = null;
MobileCallInstance.prototype.platform = null;
MobileCallInstance.prototype.router = null;

/**
 * In effect this listens for SSDP:alive and SSDP:byebye messages along with the use of SSDP queries to find out who is
 * around. These will be translated to peer availability callbacks as specified below. This code MUST meet the same
 * requirements for using a unique SSDP port, syntax for requests, etc. as {@link module:ThaliWifiInfrastructure}.
 *
 * Other requirements for this method MUST match those of
 * {@link external:"Mobile('StartListeningForAdvertisements')".callNative} in terms of idempotency. This also means
 * we MUST return "Radio Turned Off" if we are emulating Bluetooth as being off.
 *
 * @public
 * @param {module:thaliMobileNative~ThaliMobileCallback} callBack
 * @returns {null}
 */
MobileCallInstance.prototype.StartListeningForAdvertisements = function(callBack) {
  return null;
};

/**
 * This shuts down the SSDP listener/query code. It MUST otherwise behave as given for
 * {@link external:"Mobile('StopListeningForAdvertisements')".callNative}.
 *
 * @public
 * @param {module:thaliMobileNative~ThaliMobileCallback} callBack
 * @returns {null}
 */
MobileCallInstance.prototype.StopListeningForAdvertisements = function(callBack) {
  return null;
};

/**
 * This method tells the system to both start advertising and to accept incoming connections. In both cases we need
 * to accept incoming connections. The main challenge is simulating what happens when stop is called. This is supposed
 * to shut down all incoming connections. So we can't just advertise our 127.0.0.1 port and let the other mocks
 * running on the same machine connect since stop wouldn't behave properly. To handle the stop behavior, that is to
 * disconnect all incoming connections, we have to introduce a TCP level proxy. The reason we need a TCP proxy is
 * that we are using direct SSL connections in a way that may or may not properly work through a HTTPS proxy. So
 * it's simpler to just introduce the TCP proxy. We will advertise the TCP proxy's listener port in SSDP and when
 * someone connects we will create a TCP client connection to portNumber and then pipe the two connections together.
 *
 * __Open Issue:__ If we directly pipe the TCP listener socket (from Connect) and the TCP client socket (that we
 * created) then will the system automatically kill the pipe if either socket is killed? We need to test this. If it
 * doesn't then we just need to hook the close event and close the other side of the pipe.
 *
 * __Note:__ For now we are going to not simulate the Bluetooth handshake for Android. This covers the scenario where
 * device A doesn't discover device B over BLE but device B discovered device A over BLE and then connected over
 * Bluetooth. The handshake would create a simulated discovery event but we are going to assume that the SSDP
 * discovery will arrive in a timely manner and so the behavior should be the same.
 *
 * For advertising we will use SSDP both to make SSDP:alive as well as to answer queries as given in
 * {@link module:ThaliWifiInfrastructure}.
 *
 * For incoming connections we will, as described above, just rely on everyone running on 127.0.0.1.
 *
 * Otherwise the behavior MUST be the same as defined for
 * (@link external:"Mobile('StartUpdateAdvertisingAndListenForIncomingConnections')".callNative}. That includes
 * returning the "Call Start!" error as appropriate as well as returning "Radio Turned Off" if we are emulating
 * Bluetooth as being off.
 *
 * @param {number} portNumber
 * @param {module:thaliMobileNative~ThaliMobileCallback} callBack
 * @returns {null}
 */
MobileCallInstance.prototype.StartUpdateAdvertisingAndListenForIncomingConnections = function(portNumber, callBack) {
  return null;
};

/**
 * This function MUST behave like {@link module:ThaliWifiInfrastructure} and send a proper SSDP:byebye and then
 * stop responding to queries or sending SSDP:alive messages. Otherwise it MUST act like
 * (@link external:"Mobile('StopUpdateAdvertisingAndListenForIncomingConnections')".callNative} including terminating
 * the TCP proxy and all of its connections to simulate killing all incoming connections.
 *
 * @param {module:thaliMobileNative~ThaliMobileCallback} callBack
 * @returns {null}
 */
MobileCallInstance.prototype.StopAdvertisingAndListeningForIncomingConnections = function(callBack) {
  return null;
};

/**
 * All the usual restrictions on connect apply including throwing errors if start listening isn't active, handling
 * consecutive calls, etc. Please see the details in {@link external:"Mobile('Connect')".callNative}. In this case
 * the mock MUST keep track of the advertised IP and port for each peerIdentifier and then be able to establish
 * a TCP/IP listener on 127.0.0.1 and use a TCP proxy to relay any connections to the 127.0.0.1 port to the
 * IP address and port that was advertised over SSDP. The point of all this redirection is to fully simulate the
 * native layer so we can run tests of the Wrapper and above with full fidelity. This lets us do fun things like
 * simulate turning off radios as well as properly enforce behaviors such as those below that let our local listener
 * only accept one connection and simulating time outs on a single peer correctly (e.g. the other side is still
 * available but we had no activity locally and so need to tear down). If setting up the outgoing TCP proxy is a
 * big enough pain we could probably figure a way around it but I'm guessing that since we need it anyway for
 * incoming connections it shouldn't be a big deal.
 *
 * In the case of simulating Android we just have to make sure that at any time we have exactly one outgoing
 * connection to any peerIdentifier. So if we get a second connect for the same peerIdentifier then we have to
 * return the port for the existing TCP listener we are using, even if it is connected. We also need the right
 * tear down behavior so that if the local app connection to the local TCP listener (that will then relay to the
 * remote peer's port) is torn down then we tear down the connection to the remote peer and vice versa.
 *
 * On iOS we need the same behavior as Android plus we have to deal with the MCSession
 * problem. This means we have to look at the peerIdentifier, compare it to the peerIdentifier that we generated
 * at the SSDP layer and do a lexical comparison. If we are lexically smaller then we have to simulate the trick
 * that iOS uses where we create a MCSession but don't establish any connections over it. The MCSession is just used
 * as a signaling mechanism to let the lexically larger peer know that the lexically smaller peer wants to connect.
 * See the sections below on /ConnectToMeForMock and /IConnectedMock for details.
 *
 * ## Making requests to /ConnectToMeForMock
 * After we receive a connect when we are simulating iOS and the requester is lexically smaller than the target
 * peerIdentifier then we MUST make a GET request to the target peer's /ConnectToMeForMock endpoint with a query
 * argument of the form "?port=x&peerIdentifier=y". The port is the port the current peer wishes the target peer
 * to connect over and the peerIdentifier is the current peer's peerIdentifier.
 *
 * If we get a 400 response then we MUST return the "Connection could not be established" error.
 *
 * If we get a 200 OK then we just have to wait for a /IConnectedMock request to come in telling us that the remote
 * peer has established a connection. See the section below on how we handle this. Note that the usual timeout
 * rules apply so if the /IConnectedMock request does not come within the timeout period the we MUST issue a
 * "Connection wait time out" error.
 *
 * We do not include IP addresses in the request or response because we are only running the mock amongst instances
 * that are all hosted on the same box and talking over 127.0.0.1.
 *
 * ## Sending responses to /ConnectToMeForMock
 * If we are not currently simulating an iOS device then we MUST return a 500 Server Error because something really
 * bad has happened. We do not currently support simulating mixed scenarios, everyone in the test run needs to be
 * either simulating iOS or Android.
 *
 * If we are not currently listening for incoming connections then we MUST return a 400 Bad Request. But we MUST
 * also log the fact that this happened since baring some nasty race conditions we really shouldn't get a call to
 * this endpoint unless we are listening.
 *
 * If we are listening then we MUST issue a PeerAvailabilityChanged callback and set the peerIdentifier to the value in
 * the query argument, peerAvailable to true and pleaseConnect to true. We MUST also record the port in the query
 * argument so that if we get a connect request we know what port to submit.
 *
 * In theory it's possible for us to get into a situation where we get one port for a peerIdentifier in the
 * /ConnectToMeForMock request and a different port in a SSDP request. We should just publish the PeerAvailablityChanged
 * event as they come in and for internal mapping of peerIdentifier to port we should just record whatever came in
 * last. And yes, this can lead to fun race conditions which is the situation in the real world too.
 *
 * ## Making requests to /IConnectedMock
 * If we are simulating iOS and if we are establishing a TCP connection to a remote peer then by definition we are
 * the lexically larger peer. However the iOS protocol shares our peerIdentifier with the remote peer, TCP does not.
 * To work around this anytime we are simulating iOS and have successfully established a TCP connection to a remote peer
 * we MUST issue a GET request to the /IConnectedMock endpoint of the remote peer with the query string
 * "?clientPort=x&serverPort=z&peerIdentifier=y". The clientPort and serverPort are the client port and server port
 * values from the TCP connection that caused us to send this request in the first place. The peerIdentifier is our
 * peerIdentifier. If we get a 400 response back then we MUST log this event as it really should not have happened.
 *
 * ## Sending response to /IConnectedMock
 * If we are not currently simulating an iOS device then we MUST return a 500 Server Error because something really
 * bad has happened. We do not currently support simulating mixed scenarios, everyone in the test run needs to be
 * either simulating iOS or Android.
 *
 * If we are not currently listening for incoming connections then we MUST return a 400 Bad Request. But we MUST
 * also log the fact that this happened since baring some nasty race conditions we really shouldn't have been able
 * to set up the TCP connection in the first place.
 *
 * Otherwise we MUST return a 200 OK.
 *
 * When we return a 200 OK we MUST issue a PeerAvailabilityChanged callback with peerIdentifier set to the submitted
 * peerIdentifier, peerAvailable set to true and pleaseConnect set to false. If we have an outstanding connect request
 * to the specified peerIdentifier then we MUST look up the specified clientPort/serverPort and see if we can match
 * it to any of the incoming connections to the TCP proxy. If we can then we MUST return the clientPort/serverPort
 * being used by the TCP proxy as the connect response with listeningPort set to null and clientPort/serverPort
 * set to the values the TCP proxy is using. If we cannot match the connection via the TCP proxy then this means
 * that the connection might have died or been killed while this request to /IConnectedMock was being sent. In that
 * case we should send bogus values in the connect response to simulate a situation where a peer connects but then
 * the connection dies before the connect callback is returned.
 *
 * @param {string} peerIdentifier
 * @param {module:thaliMobileNative~ConnectCallback} callback
 * @returns {null}
 */
MobileCallInstance.prototype.Connect = function(peerIdentifier, callback) {
  return null;
};

/**
 * If we aren't emulating iOS then this method has to return the "Not Supported" error. If we are emulating iOS
 * then we have to kill all the TCP listeners we are using to handling outgoing connections and the TCP proxy
 * we are using to handle incoming connections.
 *
 * @public
 * @param {module:thaliMobileNative~ThaliMobileCallback} callback
 * @returns {null}
 */
MobileCallInstance.prototype.KillConnections = function(callback) {
  return null;
};



/**
 * Handles processing callNative requests. The actual params differ based on the particular Mobile method
 * that is being called.
 *
 * @returns {null}
 */
MobileCallInstance.prototype.callNative = function() {
  switch (this.mobileMethodName) {
    case "StartListeningForAdvertisements":
        return this.StartListeningForAdvertisements(arguments[0]);
    case "StopListeningForAdvertisements":
        return this.StopListeningForAdvertisements(arguments[0]);
    case "StartUpdateAdvertisingAndListenForIncomingConnections":
        return this.StartUpdateAdvertisingAndListenForIncomingConnections(arguments[0], arguments[1]);
    case "StopAdvertisingAndListeningForIncomingConnections":
        return this.StopAdvertisingAndListeningForIncomingConnections(arguments[0]);
    case "Connect":
        return this.Connect(arguments[0], arguments[1]);
    case "KillConnections":
        return this.KillConnections(arguments[0]);
    default:
        throw new Error("The supplied mobileName does not have a matching callNative method: " + this.mobileMethodName);
  }
};

/**
 * Anytime we are looking for advertising and we receive a SSDP:alive, SSDP:byebye or a response to one of our
 * periodic queries we should use it to create a PeerAvailabilityChanged call back. In practice we don't really
 * need to batch these messages so we can just fire them as we get them. The peerIdentifier is the USN from the
 * SSDP message, peerAvailable is true or false based on the SSDP response and pleaseConnect is false except for
 * the situation described above for /ConnectToMeforMock.
 *
 * @param {module:thaliMobileNative~peerAvailabilityChangedCallback} callback
 * @returns {null}
 */
MobileCallInstance.prototype.PeerAvailabilityChanged = function(callback) {
  return null;
};

/**
 * Any time there is a call to start and stop or if Bluetooth is turned off on Android (which also MUST mean
 * that we have disabled both advertising and discovery) then we MUST fire this event.
 *
 * @public
 * @param {module:thaliMobileNative~discoveryAdvertisingStateUpdateNonTCPCallback} callback
 * @returns {null}
 */
MobileCallInstance.prototype.DiscoveryAdvertisingStateUpdateNonTCP = function(callback) {
  return null;
};

/**
 * At this point this event would only fire because we called toggleBluetooth or toggleWifi. For the moment
 * we will treat toggleBluetooth and turning on/off both blueToothLowEnergy and blueTooth.
 *
 * __Open Issue:__ Near as I can tell both Android and iOS have a single Bluetooth switch that activates and
 * de-activates Bluetooth and BLE. Note however that in theory it's possible to still have one available and not
 * the other to a particular application because of app level permissions but that isn't an issue for the mock.
 *
 * @public
 * @param {module:thaliMobileNative~networkChangedCallback} callback
 * @returns {null}
 */
MobileCallInstance.prototype.NetworkChanged = function(callback) {
  return null;
};

/**
 * This is used anytime the TCP proxy for incoming connections cannot connect to the portNumber set in
 * {@link module:WifiBasedNativeMock~MobileCallInstance.StartUpdateAdvertisingAndListenForIncomingConnections}.
 *
 * @public
 * @param {module:thaliMobileNative~incomingConnectionToPortNumberFailedCallback} callback
 * @returns {null}
 */
MobileCallInstance.prototype.IncomingConnectionToPortNumberFailed = function(callback) {
  return null;
};

MobileCallInstance.prototype.registerToNative = function() {
  switch (this.mobileMethodName) {
    case "PeerAvailabilityChanged":
        return this.PeerAvailabilityChanged(arguments[0]);
    case "DiscoveryAdvertisingStateUpdateNonTCP":
        return this.DiscoveryAdvertisingStateUpdateNonTCP(arguments[0]);
    case "NetworkChanged":
        return this.NetworkChanged(arguments[0]);
    case "IncomingConnectionToPortNumberFailed":
        return this.IncomingConnectionToPortNumberFailed(arguments[0]);
    default:
        throw new Error("The supplied mobileName does not have a matching registerToNative method: " +
          this.mobileMethodName);
  }
};

/**
 * This is the method that actually handles processing the native requests. In general this method just
 * records the arguments for later use.
 *
 * @param {string} mobileMethodName This is the name of the method that was passed in on the mobile object
 * @param {platformChoice} platform
 * @param wifiBasedNativeMock
 * @constructor
 */
function MobileCallInstance(mobileMethodName, platform, wifiBasedNativeMock) {
  this.mobileMethodName = mobileMethodName;
  this.platform = platform;
  this.router = router;
  this.wifiBasedNativeMock = wifiBasedNativeMock;
}

/**
 * Enum to describe the platforms we can simulate, this mostly controls how we handle connect
 *
 * @public
 * @readonly
 * @type {{android: string, iOS: string}}
 */
var platformChoice = {
  android: "Android",
  iOS: "iOS"
};

/**
 * This simulates turning Bluetooth on and off.
 *
 * If we are emulating Android then we MUST start with Bluetooth and WiFi turned off.
 *
 * __Open Issue:__ I believe that JXCore will treat this as a NOOP if called on iOS. We need to check and emulate
 * their behavior.
 *
 * @param {platformChoice} platform
 * @param {ThaliWifiInfrastructure} wifiBasedNativeMock
 * @returns {Function}
 */
function toggleBluetooth(platform, wifiBasedNativeMock) {
  return function(setting, callback) {
    return null;
  }
}

/**
 * If we are on Android then then is a NOOP since we don't care (although to be good little programmers we should still
 * fire a network changed event). We won't be using Wifi for discovery or connectivity in the near future.
 *
 * __Open Issue:__ I believe that JXCore will treat this as a NOOP if called on iOS. We need to check and emulate
 * their behavior.
 *
 * @param {platformChoice} platform
 * @param {ThaliWifiInfrastructure} wifiBasedNativeMock
 * @returns {Function}
 */
function toggleWiFi(platform, wifiBasedNativeMock) {
  return function(setting, callback) {
    return null;
  }
}

/**
 * To use this mock save the current global object Mobile (if it exists) and replace it with this object. In general
 * this object won't exist on the desktop.
 *
 * If we are simulating iOS then we MUST add the /ConnectToMeForMock and /IConnectedMock endpoints as described above
 * to the router object.
 *
 * @public
 * @constructor
 * @param {platformChoice} platform
 * @param {Object} router This is the express router being used up in the stack. We need it here so we can add
 * a router to simulate the iOS case where we need to let the other peer know we want a connection.
 */
function WifiBasedNativeMock(platform, router) {
  var thaliWifiInfrastructure = new ThaliWifiInfrastructure();
  var mobileHandler = function(mobileMethodName) {
    return new MobileCallInstance(mobileMethodName, platform, router, thaliWifiInfrastructure);
  };

  mobileHandler.toggleBluetooth = toggleBluetooth(thaliWifiInfrastructure);

  mobileHandler.toggleWiFi = toggleWiFi(thaliWifiInfrastructure);

  return mobileHandler;
}

module.exports = WifiBasedNativeMock;
