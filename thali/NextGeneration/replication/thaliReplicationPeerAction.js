'use strict';

var Promise = require('lie');
var util = require('util');
var ThaliPeerAction = require('../thaliPeerPool/thaliPeerAction');
var actionState = ThaliPeerAction.actionState;
var assert = require('assert');
var thaliConfig = require('../thaliConfig');
var logger = require('../../thalilogger')('thaliReplicationPeerAction');
var ForeverAgent = require('forever-agent');
var LocalSeqManager = require('./localSeqManager');
var RefreshTimerManager = require('./utilities').RefreshTimerManager;
var thaliConfig = require('../thaliConfig');

/** @module thaliReplicationPeerAction */

/**
 * @classdesc Manages replicating information with a peer we have discovered
 * via notifications.
 *
 * @param {module:thaliNotificationClient.event:peerAdvertisesDataForUs} peerAdvertisesDataForUs
 * The notification that triggered this replication. This gives us the
 * information we need to create a connection as well the connection type
 * we need for the base class's constructor.
 * @param {PouchDB} PouchDB The PouchDB class constructor we are supposed to
 * use.
 * @param {string} dbName The name of the DB we will use both for local use as
 * well as remote use. Note that we will get the name for the remote database by
 * taking dbName and appending it to http://[hostAddress]:[portNumber] / +
 * thaliConfig.BASE_DB_PATH + / [name] where hostAddress and portNumber are from
 * the peerAdvertisesDataForUs argument.
 * @param {Buffer} ourPublicKey The buffer containing our ECDH public key
 * @constructor
 */
function ThaliReplicationPeerAction(peerAdvertisesDataForUs,
                                    PouchDB,
                                    dbName,
                                    ourPublicKey) {
  assert(ThaliReplicationPeerAction.maxIdlePeriodSeconds * 1000 -
    ThaliReplicationPeerAction.pushLastSyncUpdateMilliseconds >
    1000, 'Need at least a seconds worth of clearance to make sure ' +
    'that at least one sync update will have gone out before we time out.');
  assert(peerAdvertisesDataForUs, 'there must be peerAdvertisesDataForUs');
  assert(PouchDB, 'there must be PouchDB');
  assert(dbName, 'there must be dbName');
  assert(ourPublicKey, 'there must be an ourPublicKey');

  ThaliReplicationPeerAction.super_.call(this, peerAdvertisesDataForUs.keyId,
    peerAdvertisesDataForUs.connectionType,
    ThaliReplicationPeerAction.actionType,
    peerAdvertisesDataForUs.pskIdentifyField,
    peerAdvertisesDataForUs.psk);

  this._peerAdvertisesDataForUs = peerAdvertisesDataForUs;
  this._PouchDB = PouchDB;
  this._dbName = dbName;
  this._ourPublicKey = ourPublicKey;
  this._localSeqManager = null;
  this._cancelReplication = null;
  this._resolveStart = null;
  this._rejectStart = null;
  this._refreshTimerManager = null;
}

util.inherits(ThaliReplicationPeerAction, ThaliPeerAction);

/**
 * The actionType we will use when calling the base class's constructor.
 *
 * @public
 * @readonly
 * @type {string}
 */
ThaliReplicationPeerAction.actionType = 'ReplicationAction';

/**
 * The number of seconds we will wait for an existing live replication to have
 * no changes before we terminate it.
 *
 * @public
 * @readonly
 * @type {number}
 */
ThaliReplicationPeerAction.maxIdlePeriodSeconds = 30;

/**
 * The number of milliseconds to wait between updating `_Local/<peer ID>` on the
 * remote machine. See
 * http://thaliproject.org/ReplicationAcrossDiscoveryProtocol/.
 *
 * @public
 * @readonly
 * @type {number}
 */
ThaliReplicationPeerAction.pushLastSyncUpdateMilliseconds = 200;

/**
 * The replication timer is needed because by default we do live replications
 * which will keep a connection open to the remote server and send heartbeats
 * to keep things going. This means that our timers at lower levels in our
 * stack will see 'activity' and so won't time out a connection that isn't
 * actually doing useful work. This timer however is connected directly to the
 * changes feed and so can see if 'useful' work is happening and time out if it
 * is not.
 * @private
 */
ThaliReplicationPeerAction.prototype._replicationTimer = function () {
  var self = this;
  if (self._refreshTimerManager) {
    self._refreshTimerManager.stop();
  }
  self._refreshTimerManager = new RefreshTimerManager(
    ThaliReplicationPeerAction.maxIdlePeriodSeconds * 1000,
    function() {
      self._complete([new Error('No activity time out')]);
    });
  self._refreshTimerManager.start();
};

/**
 * @param {Array.<Error>} errorArray
 * @private
 */
ThaliReplicationPeerAction.prototype._complete =
  function (errorArray) {
    if (this.getActionState() === actionState.KILLED) {
      return;
    }
    ThaliReplicationPeerAction.super_.prototype.kill.call(this);
    this._refreshTimerManager && this._refreshTimerManager.stop();
    this._refreshTimerManager = null;
    this._cancelReplication && this._cancelReplication.cancel();
    this._cancelReplication = null;
    this._localSeqManager && this._localSeqManager.stop();
    this._localSeqManager = null;
    if (!errorArray || errorArray.length === 0) {
      return this._resolveStart();
    }
    for(var i = 0; i < errorArray.length; ++i) {
      if (errorArray[i].message === 'connect ECONNREFUSED') {
        return this._rejectStart(
          new Error('Could not establish TCP connection'));
      }
      if (errorArray[i].message === 'socket hang up') {
        return this._rejectStart(
          new Error(
            'Could establish TCP connection but couldn\'t keep it running'));
      }
    }
    this._rejectStart(errorArray[0]);
  };

/**
 * When start is called we will start a replication with the remote peer using
 * the settings specified below. We will need to create the URL using the
 * hostAddress and portNumber from peerAdvertisesDataForUs. Also make sure to
 * set skip_setup to true.
 *
 * If we get an error that the database doesn't exist on the remote machine that
 * is fine, we're done. Although we should log a low priority error that we
 * tried to get to a database that doesn't exist. DO NOT log the peer ID.
 *
 * We then need to use db.replication.to with the remoteDB using the URL
 * specified in the constructor. This will be the local DB we will copy to. We
 * need to do things this way so we can set the AJAX options for PSK. We also
 * need to set both options.retry and options.live to true. See the changes
 * event below for some of the implications of this.
 *
 * We must hook these events from the replication object.
 *
 * paused - We need to log this with a very low priority log value just for
 * debugging purposes. But certainly nothing that would be recorded in
 * production.
 *
 * active - Log per the previous.
 *
 * denied - This is a genuine error, it should never happen so log with high
 * priority so we can investigate. Again, don't include any identifying
 * information, not even the DB name. It's a hint.
 *
 * complete - Return resolve(); if there was no error otherwise return Reject()
 * with an Error object with the string that either matches one of the {@link
 * module:thaliPeerAction~ThaliPeerAction.start} error strings or else something
 * appropriate. Even if there is an error we should always do a final write to
 * `_Local/<peer ID>` with the last_seq in the info object passed to complete.
 *
 * error - Log with reasonably high priority but with no identifying
 * information. Otherwise take no further action as the complete event should
 * also fire and we'll handle things there.
 *
 * __OPEN ISSUE:__ We actually need to investigate what kinds of err values come
 * back in order to determine if we can figure out if it was a connection error.
 * This is important for the thread pool to know. See the errors defined on
 * {@link module:thaliPeerAction~PeerAction.start}.
 *
 * change - If we don't see any changes on the replication for {@link
 * module:thaliReplicationPeerAction~ThaliReplicatonPeerAction.maxIdlePeriodSeconds}
 * seconds then we will end the replication. The output from this event also
 * provides us with the current last_seq we have synch'd from the remote peer.
 * Per http://thaliproject.org/ReplicationAcrossDiscoveryProtocol/ we need to
 * update the remote `_Local/<peer ID>` document every
 * {@link module:thaliReplicationPeerAction~ThaliReplicationPeerAction.pushLastSyncUpdateMilliseconds}
 *
 * Make sure to keep the cancel object returned by the replicate call. Well
 * need it for kill.
 *
 * @param {http.Agent} httpAgentPool This is the HTTP connection pool to use
 * when creating HTTP requests related to this action. Note that this is where
 * the PSK related settings are specified.
 * @returns {Promise<?Error>}
 */
ThaliReplicationPeerAction.prototype.start = function (httpAgentPool) {
  var self = this;

  return ThaliReplicationPeerAction.super_.prototype.start
    .call(this, httpAgentPool)
    .then(function () {
      /*
      TODO: The code below deals with several issues in a non-obvious way.
      First, there is https://github.com/thaliproject/thali/issues/267 which
      deals with a bug in PouchDB that prevents us from using the agent
      option which we need to use httpAgentPool. The current work around is
      that we instead specify an agent class and agentOptions.

      This leads to another related issue. Because we can't use agent we
      create a situation where request (which is hiding under PouchDB on
      Node.js) will use a pool to pick an agent to use. In other words request
      will look at PouchDB's HTTP request and create a key for it and check
      the pool of agents it has and see if any match. Normally this is good
      except that request doesn't know anything about PSK so it doesn't use
      the PSK values in its pool ID calculations and thus you get fun
      events like using the same agent (with the same psk ID and key) for
      two different peers! To prevent this we put in the secureOptions
      argument which currently Node.js ignores when we use PSK. We stick
      in there both the pskId as well as the URL. The reason we need both
      is that the same PSK ID can legitimately be used with two different
      URLS (For example, if the same peer is available over both bluetooth
      and wifi). In addition the same URL can legitimately use two different
      PSK IDs (for example, beacon requests use one ID while all other
      requests use a secure ID). So we need both values to guarantee the
      right kind of uniqueness.

      We picked secureOptions because if we used cert (which is ignored when
      we use PSK) we would also have to use key. We couldn't use PFX because
      then request tries to load it! So secureOptions was our last choice and
      it seems to work.
       */
      var remoteUrl = 'https://' + self._peerAdvertisesDataForUs.hostAddress +
        ':' + self._peerAdvertisesDataForUs.portNumber +
        thaliConfig.BASE_DB_PATH +'/' + self._dbName;
      var ajaxOptions = {
        ajax : {
          agentClass: ForeverAgent.SSL,
          agentOptions : {
            rejectUnauthorized: false,
            keepAlive: true,
            keepAliveMsecs: thaliConfig.TCP_TIMEOUT_WIFI/2,
            maxSockets: Infinity,
            maxFreeSockets: 256,
            ciphers: thaliConfig.SUPPORTED_PSK_CIPHERS,
            pskIdentity: self.getPskIdentity(),
            pskKey: self.getPskKey(),
            secureOptions: self.getPskIdentity() + remoteUrl
          }
        },
        skip_setup: true// jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
      };

      var remoteDB = new self._PouchDB(remoteUrl, ajaxOptions);
      self._localSeqManager = new LocalSeqManager(
        ThaliReplicationPeerAction.pushLastSyncUpdateMilliseconds,
        remoteDB, self._ourPublicKey);
      return new Promise(function (resolve, reject) {
        self._resolveStart = resolve;
        self._rejectStart = reject;
        self._replicationTimer();
        self._cancelReplication = remoteDB.replicate.to(self._dbName, {
          live: true
        }).on('paused', function (err) {
            logger.debug('Got paused with ' + err);
          })
          .on('active', function () {
            logger.debug('Replication resumed');
          })
          .on('denied', function (err) {
            logger.warn('We got denied on a PouchDB access, this really should ' +
              'not happen - ' + err);
          })
          .on('complete', function (info) {
            self._complete(info.errors);
          })
          .on('error', function (err) {
            logger.debug('Got error on replication - ' + err);
            self._complete([err]);
          })
          .on('change', function (info) {
            self._replicationTimer();
            // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
            self._localSeqManager
              .update(info.last_seq)
              .catch(function (err) {
                logger.debug('Got error in update, waiting for main loop to ' +
                  'detect and handle - ' + err);
              });
            // jscs:enable requireCamelCaseOrUpperCaseIdentifiers
          });
      });
    });
};

/**
 * Check the base class for the core functionality but in our case the key thing
 * is that we call the cancel object we got on the replication.
 *
 */
ThaliReplicationPeerAction.prototype.kill = function () {
  this._complete();
};

module.exports = ThaliReplicationPeerAction;
