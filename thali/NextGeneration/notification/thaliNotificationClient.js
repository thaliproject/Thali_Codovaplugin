'use strict';

var PeerDictionary = require('./thaliPeerDictionary');
var ThaliMobile = require('../thaliMobile');
var ThaliNotificationAction = require('./thaliNotificationAction.js');
var NotificationBeacons = require('./thaliNotificationBeacons');
var logger = require('../../thaliLogger')('thaliNotificationClient');
var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

/** @module thaliNotificationClient */

/**
 * @classdesc Data of peerAdvertisesDataForUs event. Note that if a peer
 * has disappeared then all the values below but keyId and connectionType
 * will be null.
 * @constructor
 * @param {Buffer} keyId The buffer contains the ECDH public key for the
 * peer.
 * @param {string} pskIdentifyField
 * @param {Buffer} psk This is the calculated pre-shared key that will be
 * needed to establish a TLS PSK connection.
 * @param {string} hostAddress The IP/DNS address of the peer
 * @param {number} portNumber The TCP/IP port at the hostAddress the peer
 * can be contacted on
 * @param {number} suggestedTCPTimeout Provides a hint to what time out to
 * put on the TCP connection. For some transports a handshake can take quite a
 * long time.
 * @param {module:thaliMobile.connectionTypes} connectionType The type of
 * connection that will be used when connecting to this peer.
 */
function PeerAdvertisesDataForUs (keyId, pskIdentifyField,
                                  psk, hostAddress, portNumber,
                                  suggestedTCPTimeout, connectionType) {
  this.keyId = keyId;
  this.pskIdentifyField = pskIdentifyField;
  this.psk = psk;
  this.hostAddress = hostAddress;
  this.portNumber = portNumber;
  this.suggestedTCPTimeout = suggestedTCPTimeout;
  this.connectionType = connectionType;
}
// jscs:disable maximumLineLength
/**
 * @classdesc Creates a class that can register to receive the {@link
 * module:thaliMobile.event:peerAvailabilityChanged} event. It will listen for
 * the event and upon receiving it, will enqueue an action with the submitted
 * thaliPeerPoolInterface. Once called back by the pool then the callback will
 * issue a HTTP GET request to retrieve the notification beacons for the peer,
 * parse them, see if one matches and if so then fire a {@link
 * module:thaliNotificationClient.event:peerAdvertisesDataForUs}. Callers can
 * listen for the event by using the emitter member.
 *
 * @public
 * @constructor
 * @param {module:thaliPeerPoolInterface~ThaliPeerPoolInterface} thaliPeerPoolInterface
 * Requests to retrieve notification beacons are enqueued on this object in
 * order to make sure we don't overwhelm our bandwidth or native communication
 * capabilities.
 * @param {Crypto.ECDH} ecdhForLocalDevice A Crypto.ECDH object initialized
 * with the local device's public and private keys.
 * @fires module:thaliNotificationClient.event:peerAdvertisesDataForUs
 * @throws {Error} thaliPeerPoolInterface cannot be null
 * @throws {Error} ecdhForLocalDevice cannot be null
 */
// jscs:enable maximumLineLength
function ThaliNotificationClient(thaliPeerPoolInterface, ecdhForLocalDevice) {
  EventEmitter.call(this);
  var self = this;

  assert(thaliPeerPoolInterface,
    ThaliNotificationClient.Errors.PEERPOOL_NOT_NULL);
  assert(ecdhForLocalDevice,
    ThaliNotificationClient.Errors.EDCH_FOR_LOCAL_DEVICE_NOT_NULL);

  this.peerDictionary = null;
  this._thaliPeerPoolInterface = thaliPeerPoolInterface;
  this._ecdhForLocalDevice = ecdhForLocalDevice;
  this._publicKeysToListen = [];
  this._publicKeysToListenHashes = [];
  this._boundListener = this._peerAvailabilityChanged.bind(this);

  this._addressBookCallback = function (unencryptedKeyId) {

    if (!Buffer.isBuffer(unencryptedKeyId)) {
      logger.warn('_addressBookCallback: unencryptedKeyId is not an buffer');
      return null;
    }

    for (var i = 0 ; i < self._publicKeysToListenHashes.length ; i++) {
      var pubKeyHash = self._publicKeysToListenHashes[i];
      if (unencryptedKeyId.compare(pubKeyHash) === 0) {
        return self._publicKeysToListen[i];
      }
    }
    return null;
  };
}

util.inherits(ThaliNotificationClient, EventEmitter);

/**
 * Fired whenever we discover a peer who is looking for us.
 *
 * @public
 * @event module:thaliNotificationClient.event:peerAdvertisesDataForUs
 * @type {PeerAdvertisesDataForUs}
 */
ThaliNotificationClient.prototype.Events = {
  PeerAdvertisesDataForUs: 'peerAdvertisesDataForUs'
};

/**
 * A dictionary used to track the state of peers we have received notifications
 * about from {@link module:thaliMobile}.
 *
 * @type {ThaliNotificationClient.PeerDictionary}
 */
ThaliNotificationClient.prototype.peerDictionary = null;

/**
 * This method will cause a listener to be registered on the global singleton
 * {@link module:thaliMobile} object for the {@link
 * module:thaliMobile.event:peerAvailabilityChanged} event.
 *
 * This is not idempotent method since it can be called multiple times with
 * different prioritization lists but repeated start calls MUST only update that
 * list and MUST NOT cause multiple listeners to be registered with thaliMobile.
 *
 * @public
 * @param {Buffer[]} publicKeysToListen Used to decide what peer
 * notifications to pay attention to. This list consists of an array
 * of buffers that contain the serialization of the public ECDH keys of the
 * peers we are interested in syncing with.
 *
 * @throws {Error} Public keys to listen must be an array
 */
ThaliNotificationClient.prototype.start =
  function (publicKeysToListen) {
    var self = this;

    assert(Array.isArray(publicKeysToListen),
      ThaliNotificationClient.Errors.PUBLIC_KEYS_TO_LISTEN_NOT_ARRAY);

    this._publicKeysToListen = [];
    this._publicKeysToListenHashes = [];

    this._publicKeysToListen = publicKeysToListen;

    publicKeysToListen.forEach(function (pubKy) {
      self._publicKeysToListenHashes.push(
        NotificationBeacons.createPublicKeyHash(pubKy));
    });

    if (!this.peerDictionary) {
      ThaliMobile.emitter.on('peerAvailabilityChanged',
        this._boundListener);
    }
    this.peerDictionary = new PeerDictionary.PeerDictionary();
  };

/**
 * This method will cause the ThaliNotificationClient to stop listening on
 * {@link module:thaliMobile.event:peerAvailabilityChanged} events and
 * {@link module:thaliNotificationAction.eventEmitter:Resolved} events.
 * It will also clean the peerDictionary object.
 *
 * @public
 */
ThaliNotificationClient.prototype.stop = function () {

  if (this.peerDictionary) {
    ThaliMobile.emitter.removeListener('peerAvailabilityChanged',
      this._boundListener);

    this.peerDictionary.removeAll();
    this.peerDictionary = null;
  }
};

/**
 * This method handles
 * {@link module:thaliMobile.event:peerAvailabilityChanged}
 * events. New peers will be connected with
 * {@link module:thaliNotificationAction.ThaliNotificationAction} and
 * the action will sort out if we want to communicate with the peer. If
 * we want to communicate with it then ThaliNotificationClient will
 * emit {@link module:thaliNotificationClient.event:peerAdvertisesDataForUs}
 * event.
 *
 * All new actions that we created for incoming peers will be stored
 * in the dictionary. And if we receive an event with null address
 * for peer that already exists in the dictionary this will abort
 * existing action and remove the item from the dictionary.
 *
 * @private
 * @param {module:thaliMobile~discoveryAdvertisingStatus} peerStatus An
 * incoming peer variable.
 */
ThaliNotificationClient.prototype._peerAvailabilityChanged =
  function (peerStatus) {

    if (!this.peerDictionary) {
      return;
    }
    if (!peerStatus) {
      logger.warn('_peerAvailabilityChanged: peerStatus is not set');
      return;
    }
    if (!peerStatus.peerIdentifier) {
      logger.warn('_peerAvailabilityChanged: peerIdentifier is not set');
      return;
    }

    if (peerStatus.hostAddress &&
        peerStatus.portNumber &&
        peerStatus.suggestedTCPTimeout &&
        peerStatus.connectionType)
    {
      assert(!this.peerDictionary.exists(peerStatus.peerIdentifier),
        'peerAvailabilityChanged event with the same peerId'+
        ' should not occur. peerIdentifier:' + peerStatus.peerIdentifier);

      var peerConnectionInfo = new PeerDictionary.PeerConnectionInformation(
        peerStatus.connectionType, peerStatus.hostAddress,
        peerStatus.portNumber, peerStatus.suggestedTCPTimeout);

      var peerEntry = new PeerDictionary.NotificationPeerDictionaryEntry(
        PeerDictionary.peerState.CONTROLLED_BY_POOL);

      this._createNewAction(peerEntry, peerStatus.peerIdentifier,
        peerConnectionInfo);
    }
    else if (!peerStatus.hostAddress) {
      // Remove the old peer if it exists.
      this.peerDictionary.remove(peerStatus.peerIdentifier);
    }
  };

// jscs:disable maximumLineLength
/**
 * This function creates a new action and sets connection info into it.
 * Then it enqueues the action in the peer pool and adds the entry into
 * the dictionary.
 *
 * @private
 * @param {module:thaliPeerDictionary~NotificationPeerDictionaryEntry} peerEntry
 * @param {string} peerIdentifier
 * @param {module:thaliPeerDictionary.PeerConnectionInformation} peerConnectionInfo
 */
// jscs:enable maximumLineLength
ThaliNotificationClient.prototype._createNewAction =
  function (peerEntry, peerIdentifier, peerConnectionInfo ) {

    var action = new ThaliNotificationAction(
      peerIdentifier,
      this._ecdhForLocalDevice,
      this._addressBookCallback,
      peerConnectionInfo);

    action.eventEmitter.on(ThaliNotificationAction.Events.Resolved,
      this._resolved.bind(this));

    peerEntry.notificationAction = action;

    var enqueueError = this._thaliPeerPoolInterface.enqueue(action);

    if (!enqueueError) {
      this.peerDictionary.addUpdateEntry(peerIdentifier, peerEntry);
    } else {
      logger.warn('_createAndEnqueueAction: failed to enqueue an item: %s',
        enqueueError.message);
    }
  };

/**
 * This function handles
 * {@link module:thaliNotificationAction.eventEmitter:Resolved} events
 * coming from the actions.
 *
 * @private
 * @param {string} peerId Identifies the peer this action belongs to.
 * @param {module:thaliNotificationAction.ActionResolution} resolution
 * The result of the actions.
 * @param {?module:thaliNotificationBeacons~parseBeaconsResponse} beaconDetails
 * Null if none of the beacons could be validated as being targeted
 * at the local peer or if the beacon came from a remote peer the
 * local peer does not wish to communicate with. If not null then a
 * beacon has been identified to be targeted at the local peer.
 */
// jscs:disable maximumLineLength
ThaliNotificationClient.prototype._resolved =
  function (peerId, resolution, beaconDetails) {

    if (!this.peerDictionary) {
      return;
    }

    var entry = this.peerDictionary.get(peerId);

    if (!entry) {
      return;
    }

    switch (resolution) {
      case ThaliNotificationAction.ActionResolution
        .BEACONS_RETRIEVED_AND_PARSED:
      {
        entry.peerState = PeerDictionary.peerState.RESOLVED;
        this.peerDictionary.addUpdateEntry(peerId, entry);

        if (!beaconDetails) {
          // This peerId has nothing for us, if that changes then the peer will
          // generate a new peerId so we can safely ignore this peerId from
          // now on.
          break;
        }

        var connInfo = entry.notificationAction.getConnectionInformation();

        var pubKx = this._addressBookCallback(beaconDetails.unencryptedKeyId);

        var pskIdentifyField =
          NotificationBeacons.generatePskIdentityField(
            beaconDetails.preAmble, beaconDetails.encryptedBeaconKeyId);

        var pskSecret = NotificationBeacons.generatePskSecret(
          this._ecdhForLocalDevice, pubKx, pskIdentifyField);

        var peerAdvertises = new PeerAdvertisesDataForUs(
          pubKx,
          pskIdentifyField,
          pskSecret,
          connInfo.getHostAddress(),
          connInfo.getPortNumber(),
          connInfo.getSuggestedTCPTimeout(),
          entry.notificationAction.getConnectionType()
        );

        this.emit(this.Events.PeerAdvertisesDataForUs,
          peerAdvertises);

        break;
      }

      case ThaliNotificationAction.ActionResolution.BEACONS_RETRIEVED_BUT_BAD:
      {
        // This indicates a malfunctioning peer. We need to assume they are bad
        // all up and mark their entry as RESOLVED without taking any further
        // action. This means we will ignore this peerIdentifier in the future.
        entry.peerState = PeerDictionary.peerState.RESOLVED;
        this.peerDictionary.addUpdateEntry(peerId, entry);
        break;
      }

      case ThaliNotificationAction.ActionResolution.HTTP_BAD_RESPONSE:
      case ThaliNotificationAction.ActionResolution.NETWORK_PROBLEM:
      case ThaliNotificationAction.ActionResolution.KILLED:
      {
        // This tells us that the peer is there but not in good shape or
        // ThaliPeerPoolInterface called kill due to resource exhaustion.
        // We will for wait time out specified in the RETRY_TIMEOUTS
        // array and try again.
        var timeOutHandler = function (peerId) {

          entry = this.peerDictionary.get(peerId);
          if (entry && entry.peerState === PeerDictionary.peerState.WAITING) {
            this._createNewAction(
              entry,
              peerId,
              entry.notificationAction.getConnectionInformation());
          } else {
            assert(false, 'unknown state should be WAITING');
          }
        };

        var maxRetries = ThaliNotificationClient.RETRY_TIMEOUTS.length;
        if (entry.retryCounter < maxRetries) {

          entry.peerState = PeerDictionary.peerState.WAITING;
          this.peerDictionary.addUpdateEntry(peerId, entry);

          // Adds 0 - 100 ms random component to keep concurrent tryouts
          // out of sync.
          var timeOut =
            ThaliNotificationClient.RETRY_TIMEOUTS[entry.retryCounter++] +
            Math.floor(Math.random() * 101);

          entry.waitingTimeout = setTimeout(
            timeOutHandler.bind(this, peerId),
            timeOut);
          this.peerDictionary.addUpdateEntry(peerId, entry);
        } else {
          // Gives up after all the timeouts from the RETRY_TIMEOUTS array
          // has been spent.
          entry.peerState = PeerDictionary.peerState.RESOLVED;
          this.peerDictionary.addUpdateEntry(peerId, entry);
        }
        break;
      }
    }
  };
// jscs:enable maximumLineLength
/**
 * We use following timeouts to retry when the action fails with network
 * error.
 *
 * @public
 * @type {number[]}
 */
ThaliNotificationClient.RETRY_TIMEOUTS =
  [100, 300, 600, 1200, 2400 , 4800, 9600];

ThaliNotificationClient.Errors = {
  PEERPOOL_NOT_NULL : 'thaliPeerPoolInterface must not be null',
  EDCH_FOR_LOCAL_DEVICE_NOT_NULL : 'ecdhForLocalDevice must not be null',
  PUBLIC_KEYS_TO_LISTEN_NOT_ARRAY: 'Public keys to listen must be an array'
};

module.exports = ThaliNotificationClient;
