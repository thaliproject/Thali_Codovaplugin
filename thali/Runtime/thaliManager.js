'use strict';

var logger = require('./utils/thaliLogger')('thaliManager');

var thaliConfig = require('./thaliConfig');
var ThaliMobile = require('./networking/thaliMobile');
var ThaliSendNotificationBasedOnReplication =
  require('./replication/thaliSendNotificationBasedOnReplication');
var ThaliPullReplicationFromNotification =
  require('./replication/thaliPullReplicationFromNotification');

var express = require('express');
var salti = require('salti');
var path = require('path');
var Promise = require('lie');
var assert = require('assert');

/** @module thaliManager */

/**
 * @classdesc This may look like a class but it really should only have one
 * instance or bad stuff can happen.
 *
 * @public
 * @param {expressPouchdb} expressPouchDB The express-pouchdb object we are
 * supposed to use to create the router.
 * @param {PouchDB} PouchDB PouchDB object we are supposed to use to create
 * dbs. Typically this should have PouchDB.defaults set with db to
 * require('leveldown-mobile') and prefix to the path where the application
 * wishes to store the DB.
 * @param {string} dbName Name of the db, both locally and remotely that we are
 * interacting with.
 * @param {Crypto.ECDH} ecdhForLocalDevice A Crypto.ECDH object initialized with
 * the local device's public and private keys.
 * @param {module:thaliPeerPoolInterface~ThaliPeerPoolInterface} [thaliPeerPoolInterface]
 * If your app doesn't specify its own pool interface you will seriously
 * regret it as the default one has awful behavior. Building your own
 * thaliPeerPoolInterface is pretty much a requirement for a decent Thali app.
 *
 * @constructor
 */
function ThaliManager(expressPouchDB,
                      PouchDB,
                      dbName,
                      ecdhForLocalDevice,
                      thaliPeerPoolInterface) {
  var self = this;

  this._router = express.Router();
  this._router.all('*', this._connectionFilter.bind(this));

  this._router.all('*', salti(
    dbName,
    ThaliManager._acl,
    this._resolveThaliId.bind(this),
    { dbPrefix: thaliConfig.BASE_DB_PATH }
  ));

  logger.debug('creating ThaliSendNotificationBasedOnReplication instance');

  this._thaliSendNotificationBasedOnReplication =
    new ThaliSendNotificationBasedOnReplication(
        this._router,
        ecdhForLocalDevice,
        thaliConfig.BEACON_MILLISECONDS_TO_EXPIRE,
        new PouchDB(dbName));
  this._getPskIdToSecret =
    self._thaliSendNotificationBasedOnReplication.getPskIdToSecret();
  this._getPskIdToPublicKey =
    self._thaliSendNotificationBasedOnReplication.getPskIdToPublicKey();

  logger.debug('creating ThaliPullReplicationFromNotification instance');

  this._thaliPullReplicationFromNotification =
    new ThaliPullReplicationFromNotification(
        PouchDB,
        dbName,
        thaliPeerPoolInterface,
        ecdhForLocalDevice);
  this._thaliPeerPoolInterface = thaliPeerPoolInterface;

  logger.debug('creating express pouchdb instance');

  this._router.use(thaliConfig.BASE_DB_PATH, expressPouchDB(PouchDB, {
    mode: 'minimumForPouchDB'
  }));

  this.state = ThaliManager.STATES.CREATED;
}

/**
 * This is a list of states for ThaliManager.
 * @public
 * @readonly
 * @enum {string}
 */
ThaliManager.STATES = {
  CREATED: 'created',
  STARTING: 'starting',
  STARTED: 'started',
  STOPPING: 'stopping',
  STOPPED: 'stopped'
};

/**
 * Starts up everything including listening for advertisements, sending out
 * our advertisements, generating beacons to notify peers that we have data
 * for them as well as running pull replication jobs to pull data from other
 * peers who have data for us.
 *
 * This method is not idempotent as each call to start with different arguments
 * will cause the related states to be changed.
 *
 * @param {Buffer[]} [arrayOfRemoteKeys] This is the list of ECDH public keys
 * that we should be willing to send notifications of our changes to and receive
 * notifications of changes from.
 * @returns {Promise<?Error>}
 */
ThaliManager.prototype.start = function (arrayOfRemoteKeys) {
  var self = this;

  // Can we start now?
  var args = arguments;
  switch (this.state) {
    case ThaliManager.STATES.STARTING: {
      return this._startingPromise;
    }
    case ThaliManager.STATES.STARTED: {
      return Promise.resolve();
    }
    case ThaliManager.STATES.STOPPING: {
      return this._stoppingPromise
        .then(function () {
          return self.start.apply(self, args);
        });
    }
  }
  assert(
    this.state === ThaliManager.STATES.CREATED ||
    this.state === ThaliManager.STATES.STOPPED,
    'ThaliManager state should be \'CREATED\' or \'STOPPED\' for start'
  );
  this.state = ThaliManager.STATES.STARTING;

  logger.debug('starting thaliPullReplicationFromNotification');
  this._thaliPullReplicationFromNotification.start(arrayOfRemoteKeys)

  logger.debug('starting ThaliMobile');
  this._startingPromise = ThaliMobile.start(self._router, self._getPskIdToSecret)

  .then(function () {
    /*
    Ideally we could call startListening and startUpdateAdvertising separately
    but this causes problems in iOS. The issue is that we deal with the
    restriction that there can only be one MCSession between two devices by
    having a leader election where one device will always form the session.
    Imagine that there is device A and B. B is advertising. A hears the
    advertisement and wants to connect but it can't start the session. So what
    it has to do is send an invite to B, who will reject the invite but then
    respond with its own invite to A. For this to work however B has to be
    listening for advertisements (not just making them) because otherwise
    there is no way in iOS for A to ask B for a session (that will be
    refused). Simultaneously A must be listening for advertisements (or it
    wouldn't have heard B) and it must be advertising itself or B couldn't
    establish the MCSession with it. So in practice this means that in iOS
    everyone has to be both listening and advertising at the same time.
    */
    logger.debug('start listening for advertisements');
    return ThaliMobile.startListeningForAdvertisements();
  })

  .then(function () {
    logger.debug('start update advertising and listening');
    return ThaliMobile.startUpdateAdvertisingAndListening();
  })

  .then(function () {
    logger.debug('starting thaliSendNotificationBasedOnReplication');
    return self._thaliSendNotificationBasedOnReplication.start(arrayOfRemoteKeys);
  })

  .then(function () {
    self.state = ThaliManager.STATES.STARTED;
    self._startingPromise = undefined;
  });

  return this._startingPromise;
};

/**
 * Shuts down the radios and deactivates all replications.
 * @public
 * @returns {Promise<?Error>}
 */
ThaliManager.prototype.stop = function () {
  var self = this;

  // Can we stop now?
  var args = arguments;
  switch (this.state) {
    case ThaliManager.STATES.CREATED:
    case ThaliManager.STATES.STOPPED: {
      return Promise.resolve();
    }
    case ThaliManager.STATES.STOPPING: {
      return this._stoppingPromise;
    }
    case ThaliManager.STATES.STARTING: {
      return this._startingPromise
        .then(function () {
          return self.stop.apply(self, args);
        });
    }
  }
  assert(
    this.state === ThaliManager.STATES.STARTED,
    'ThaliManager state should be \'STARTED\' for stop'
  );
  this.state = ThaliManager.STATES.STOPPING;

  logger.debug('stopping thaliPullReplicationFromNotification');
  this._thaliPullReplicationFromNotification.stop()

  logger.debug('stopping thaliPeerPoolInterface');
  this._stoppingPromise = this._thaliPeerPoolInterface.stop()

  .then(function () {
    logger.debug('stopping thaliSendNotificationBasedOnReplication');
    return self._thaliSendNotificationBasedOnReplication.stop();
  })

  .then(function () {
    logger.debug('stopping advertising and listening');
    return ThaliMobile.stopAdvertisingAndListening();
  })

  .then(function () {
    logger.debug('stopping listening for advertisements');
    return ThaliMobile.stopListeningForAdvertisements();
  })

  .then(function () {
    logger.debug('stopping ThaliMobile');
    return ThaliMobile.stop();
  })

  .then(function () {
    self.state = ThaliManager.STATES.STOPPED;
    self._stoppingPromise = undefined;
  });

  return this._stoppingPromise;
};

/**
 * This is connection filter. What role we can assign to request.connection?
 * @private
 * @param {object} request
 * @param {object} response
 * @param {Function} nextHandler
 * @returns {boolean}
 */
ThaliManager.prototype._connectionFilter = function (request, response, nextHandler) {
  logger.debug(
    'connected pskIdentity', request.connection.pskIdentity,
    'for path', request.path
  );

  // We need to let connections passing through the connection filter
  // in starting, started and stopping state in order to let peer actions be
  // properly started and stopped.
  assert(
    this.state === ThaliManager.STATES.STARTING ||
    this.state === ThaliManager.STATES.STARTED ||
    this.state === ThaliManager.STATES.STOPPING,
    'ThaliManager is not ready to accept any connection when state is ' + this.state
  );

  if (request.connection.authorized) {
    var secret = this._getPskIdToSecret(request.connection.pskIdentity);
    if (secret === thaliConfig.BEACON_KEY) {
      /*
        * When folks want to access the beacon they need to connect via TLS with a
        * predefined PSK. So we need to check for the magic PSK and if used then the
        * caller will only be allowed to make a GET request to the beacon path and
        * nothing else.
        * The current magic PSK identity value is 'beacons' and the secret is a binary
        * array consisting of 16 zero bytes in a row.
        */
      request.connection.pskRole = 'beacon';
    } else if (secret) {
      /*
        * In this role the user connected over TLS using a PSK that we can associate
        * with an identity (this is generated as part of beacon generation). We would
        * then surface the public key for the identity to the router who would check
        * that the path for the request is from our white list. The white list will
        * contain Express-Pouch DB paths and methods that the caller can get to. These
        * will include paths/methods needed for pull replication as well as the ability
        * to get to _Local.
        */
      request.connection.pskRole = 'replication';
    } else {
      // Default role. It is usually unused.
      request.connection.pskRole = 'public';
    }
  } else {
    logger.debug('connected pskIdentity is not authorized');
    return response.status(401).send({
      success: false,
      message: 'Unauthorized'
    });
  }

  nextHandler();
}

/**
 * This is thali id callback. Is thali id valid?
 * @private
 * @param {string} thaliId
 * @param {object} request
 * @returns {boolean}
 */
ThaliManager.prototype._resolveThaliId = function (thaliId, request) {
  // In the case of an id that begins with the string [LOCAL_SEQ_POINT_PREFIX]
  // we MUST enforce that the value of the :id EXACTLY matches the hashed
  // public key of the caller as generated by thaliNotificationBeacons.createPublicKeyHash.

  var publicKey = this._getPskIdToPublicKey(request.connection.pskIdentity);
  assert(Buffer.isBuffer(publicKey), 'publicKey should be a buffer');
  return Buffer.compare(new Buffer(thaliId, 'base64'), publicKey) === 0;
}

/**
 * This method will provide the actual state of ThaliManager
 * @public
 */
ThaliManager.prototype.getState = function () {
  return this.state;
}

/**
 * ACL data for roles.
 * @private
 * @type {Object}
 * @readonly
 */
ThaliManager._acl = [
  {
    'role': 'replication',
    'paths': [
      {
        'path': thaliConfig.BASE_DB_PATH,
        'verbs': ['GET']
      },
      {
        'path': '/{:db}',
        'verbs': ['GET']
      },
      {
        'path': '/{:db}/_all_docs',
        'verbs': ['GET', 'HEAD', 'POST']
      },
      {
        'path': '/{:db}/_bulk_docs',
        'verbs': ['GET', 'HEAD', 'POST']
      },
      {
        'path': '/{:db}/_bulk_get',
        'verbs': ['POST']
      },
      {
        'path': '/{:db}/_changes',
        'verbs': ['GET', 'POST']
      },
      {
        'path': '/{:db}/_revs_diff',
        'verbs': ['POST']
      },
      {
        'path': '/{:db}/:id',
        'verbs': ['GET']
      },
      {
        'path': '/{:db}/:id/attachment',
        'verbs': ['GET']
      },
      {
        'path': '/{:db}/_local/{:id}',
        'verbs': ['GET', 'PUT', 'DELETE']
      },
      {
        'path': '/{:db}/_local/' + thaliConfig.LOCAL_SEQ_POINT_PREFIX + '{:id}',
        'verbs': ['GET', 'PUT', 'DELETE']
      }
    ]
  },
  {
    'role': 'beacon',
    'paths': [
      {
        'path': '/NotificationBeacons',
        'verbs': ['GET']
      }
    ]
  }
];

module.exports = ThaliManager;
