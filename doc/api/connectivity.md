# Thali Peer Discovery and Communication API #

This is the interface to be implemented by the native layer for handling local discovery and peer to peer communication.  The [`ThaliEmmitter`](thaliemitter.md) class is for use by developers which communicates with the Thali Peer Communication API.

## Methods:
- `StartBroadcasting`
- `StopBroadcasting`
- `Connect`
- `Disconnect`

## Testing Methods
- `KillConnection`

## Events:
- `peerAvailabilityChanged`
- `networkChanged`

***

METHODS:

***

### `StartBroadcasting(deviceName, portNumber, callback)`

This method instructs the native layer to broadcast the availability of the device under the specified deviceName and to direct any incoming connections to the specified port number available on localhost over TCP/IP.  Calling this method twice without a `StopBroadcasting` call in between will result in an error.

#### Arguments:

1. `deviceName` : `String` – the device name.
2. `portNumber` : `Number` – a port number to direct any incoming TCP/IP connections
3. `callback` : `Function` – must be in the form of the following, `function (err)` where:
  - `err` : `String` – a string value containing the error if one occurred, else `null`

***

### `StopBroadcasting(callback)`

This method stops broadcasting of its availability. If this method is called before `StartBroadcasting`, this will result in an error.

#### Arguments:

1. `callback` : `Function` – must be in the form of the following, function (err) where:
    - `err` : `String` – a string value containing the error if one occurred, else `null`

***

### `Connect(peerIdentifier, callback)`

This method instructs the native layer to establish a TCP/IP connection to the peer identified by the peerIdentifier, which is obtained via a `peerAvailabilityChanged` event.  If this is called twice with the same peer identifier without a `Disconnect` call will result in an error.

#### Arguments:

1. `peerIdentifier` : `String` – peer identifier found during the `peerAvailabilityChanged` event.
2. `callback` : `Function` – must be in the form of the following, `function (err, port)` where:
    - `err` : `String` – a string value containing the error if one occurred, else null
    - `port` : `Number` – the port number to connect to the remote peer over TCP/IP

***

### `Disconnect(peerIdentifier, callback)`

This method disconnects from the peer by the given peer identifier.  If the peer is already disconnected and `Disconnect` is called again will result in an error in the callback.

#### Arguments:

1. `peerIdentifier` : `String` – peer identifier found during the peerAvailabilityChanged event.
2. `callback` : `Function` – must be in the form of the following, `function (err)` where:
    - `err` : `String` – a string value containing the error if one occurred, else `null`

***

### `KillConnection(peerIdentifier, callback)`

This method kills the connection for the given peer identifier to simulate crashes.  There is no cleanup done on the connection during the kill connection.  This is not intended for use in production code and is solely used for testing.

#### Arguments:

1. `peerIdentifier` : `String` – peer identifier found during the peerAvailabilityChanged event.
2. `callback` : `Function` – must be in the form of the following, `function (err)` where:
    - `err` : `String` – a string value containing the error if one occurred, else `null`

***

EVENTS:

***

### `peerAvailabilityChanged`

This event is called when a peer’s availability has changed.

#### Callback Arguments:

1. `peers` : `Array<PeerAvailability>` where `PeerAvailability` has the following properties:
    - `peerIdentifier` : `String` – the peer identifier
    - `peerName` : `String` – the name of the peer
    - `peerAvailable` : `Boolean` – whether the peer is available or not

***

### `networkChanged`

This event is called when the network has changed.

#### Callback Arguments:

1. `networkChanged` : `NetworkChanged` where it has the following properties:
    - `isAvailable` : `Boolean` – whether the network is available
    - `isWifi` : `Boolean` – whether or not the network is WiFi
