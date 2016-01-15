# The `ThaliReplicationManager` class

The `ThaliReplicationManager` class handles database replication between devices, using [PouchDB](http://pouchdb.com/) and the Thali Cordova bridge `ThaliEmitter` class.  This class is meant solely for the purpose of demonstrating [Thali Story 0](http://thaliproject.org/stories) and will be dramatically enhanced in the future.

## Usage

This is the basic usage to start the replication manager.

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('started', function () {
  console.log('Thali replication manager started');
});

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```

## `ThaliReplicationManager` API
- `ThaliReplicationManager` constructor

### `ThaliReplicationManager` Instance Methods
- `start`
- `stop`
- `getDeviceIdentity`

### `ThaliReplicationManager` Events
- `starting`
- `started`
- `stopping`
- `stopped`
- `startError`
- `stopError`
- `connectionSuccess`

## `ThaliReplicationManager(db)` constructor

Creates a new instance of the `ThaliReplicationManager` class with a PouchDB instance.

#### Arguments:
1. `db` : `PouchDB` - a PouchDB instance used for synchronization across devices.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);
```
***

## Methods

### `ThaliReplicationManager.prototype.start(port, dbName, [deviceName])`

This method starts the Thali Replication Manager with the given device name, port number used for synchronization and database name to synchronize.  Once called this method emits the `starting` event.  Once started, the `started` event is fired.  If there is an error in starting the Thali Replication Manager, the `startError` event will fire.

#### Arguments:
1. `port`: `Number` - the port number used for synchronization.
2. `dbName`: `String` - the name of the database.
3. `deviceName`: `String` - (optional) the device name to start broadcasting. If not supplied, it will be obtained from the cryptomanager (as a public key hash).

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('started', function () {
  console.log('Thali replication manager started');
});

manager.start(5000 /* port */, 'thali' /* db name */, 'deviceName' /* optional device name*/);
```
***

### `ThaliEmitter.prototype.stop()`

This method stops the Thali Replication Manager.  Once called, this will fire the `stopping` event.  Once stopped, 
the `stopped` event will fire.  If an error occurs stopping the Thali Replication Manager, the `stopError` event 
will fire.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('started', function () {
  manager.stop();
});

manager.on('stopped', function () {
  console.log('Thali replication manager stopped');
})

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```

### 'ThaliEmitter.prototype.getDeviceIdentity(cb)

This method will return a string containing the hash of the user's root public key.

#### Example

``` js
var ThaliReplicationManager = require('thali');
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);
manager.getDeviceIdentity(function(error, hash) {
  if (error) {
    console.log("Catastrophic failure - system couldn't get hash - " + error);
  }
  userPublicKeyHash = hash;
}
```

***

## Events

### `starting`

This event is called once `start` has been called and before it has fully started with the `started` event or an error was raised with the `startError` event.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('starting', function () {
  console.log('Thali replication manager is starting');
});

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```
***

### `started`

This event is called once `start` has been called and has successfully started.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('started', function () {
  console.log('Thali replication manager has started');
});

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```
***

### `startError`

This event is called once `start` has been called and has not started successfully.

#### Callback Arguments:

1. `error` : An error which occurred during starting the Thali Replication Manager.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('startError', function (err) {
  console.log('Thali replication failed to start: %s', err);
});

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```
***

### `stopping`

This event is called once `stop` has been called and before it has fully stopped with the `stopped` event or an error was raised with the `stopError` event.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('started', function () {
  manager.stop();
});

manager.on('stopping', function () {
  console.log('Thali replication manager is stopping');
});

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```
***

### `stopped`

This event is called once `stop` has been called and has successfully stopped.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('started', function () {
  manager.stop();
});

manager.on('stopped', function () {
  console.log('Thali replication manager has stopped');
});

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```
***

### `stopError`

This event is called once `stop` has been called and has not stopped successfully.

#### Callback Arguments:

1. `error` : An error which occurred during starting the Thali Replication Manager.

#### Example:

```js
var ThaliReplicationManager = require('thali');
var PouchDB = require('pouchdb');
var db = new PouchDB('dbname');

var manager = new ThaliReplicationManager(db);

manager.on('started', function () {
  manager.stop();
});

manager.on('stopError', function (err) {
  console.log('Thali replication manager failed to stop: %s', err);
});

manager.start('deviceName', 5000 /* port */, 'thali' /* db name */);
```
***

### `connectionSuccess`

This event is called anytime we successfully connect the client mux to a remote device.

__NOTE__ - This is a temporary event being used to help run identity exchange. It will be removed once
we have a proper notification infrastructure and also support a mux level connect that can handle multiple
different parts of our app wanting to connect to the same peer. Or, put in the next, this will continue
until we have ACLs and now we won't just automatically create connections to everyone.

#### Callback Arguments:

1. `peer` :
    - `peerIdentifier` : `String` - The device ID of the peer we connected to
    - `muxPort` : `Number` - The TCP/IP port that the client mux is listening on
    
#### Example:

#### Implementation
We currently only call connect in exactly one place. So we just need to stick in an event emit after
that one place and we are good. Keep in mind that we explicitly aren't putting in a connectionFailure
event because for our current use case we don't care.

***
