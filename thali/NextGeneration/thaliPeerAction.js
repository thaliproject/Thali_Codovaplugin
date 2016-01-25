'use strict';

var Promise = require('lie');

/** @module thaliPeerAction */

/**
 * Records the current state of the action.
 *
 * @public
 * @readonly
 * @enum {string}
 */
module.exports.actionState = {
  /** The action has been created but hasn't started or ended yet. */
  CREATED: 'created',
  /** The action is out of the queue and is currently running */
  STARTED: 'started',
  /** The action is not running and not in the queue */
  KILLED: 'killed'
};

/**
 * An action that has been given to the pool to manage.
 *
 * When an action is created its state MUST be CREATED.
 *
 * BugBug: In a sane world we would have limits on how long an action can run
 * and we would even set up those limits as a config item. But for now we let
 * each action own the stage for as long as it would like.
 *
 * @public
 * @interface PeerAction
 * @constructor
 * @param {string} peerIdentifier
 * @param {module:thaliMobile.connectionTypes} connectionType
 * @param {string} actionType
 */
function PeerAction (peerIdentifier, connectionType, actionType)
{
  this.peerIdentifier = peerIdentifier;
  this.connectionType = connectionType;
  this.actionType = actionType;
  this.actionState = module.exports.actionState.STARTED;
}

/**
 * The remote peer this action targets
 * @private
 * @type {string}
 */
PeerAction.prototype.peerIdentifier = null;

PeerAction.prototype.getPeerIdentifier = function () {
  return this.peerIdentifier;
};

/**
 * The type of connection the requests will be sent over
 * @private
 * @type {module:thaliMobile.connectionTypes}
 */
PeerAction.prototype.connectionType = null;

PeerAction.prototype.getConnectionType = function () {
  return this.connectionType;
};

/**
 * The type of action that will be taken
 * @private
 * @type {string}
 */
PeerAction.prototype.actionType = null;

PeerAction.prototype.getActionType = function () {
  return this.actionType;
};

/**
 * The current state of the action
 * @private
 * @type {module:thaliPeerAction.actionState}
 */
PeerAction.prototype.actionState = null;

PeerAction.prototype.getActionState = function () {
  return this.actionState;
};

/**
 * Tells the action to begin processing. When the action has completed it will
 * resolve the returned promise successfully with a null value. Once the
 * returned promise resolves then the pool MUST stop tracking this action.
 * Errors from the promise results SHOULD be logged.
 *
 * Start is idempotent so multiple calls MUST NOT directly cause a state change.
 * That is, if the action hasn't started then the first call to start will
 * start it and further calls will accomplish nothing more than just returning
 * the same promise that the original call returned.
 *
 * If start is called on an action that has completed, successfully or not, then
 * the returned promised must be resolved with an error object MUST with the
 * value "action has completed."
 *
 * If the action fails due to a network issue it is important that this be
 * reported to the pool because it can use this information to decide how to
 * schedule things. The pool is expected to have subscribed for events like
 * {@link module:thaliMobile.event:networkChanged} and
 * {@link module:thaliMobile.event:discoveryAdvertisingStateUpdate} and so
 * understand when there are general connections failures. The action MUST use
 * the following error messages if the related errors occur.
 *
 * "Could not establish TCP connection" - This error indicates that the action
 * gave up because it got too many errors trying to connect over TCP to its
 * target peer.
 *
 * "Could establish TCP connection but couldn't keep it running" - In a HTTP
 * context this primarily to cases where a connection appears to exist but
 * all HTTP requests never seem to be able to successfully complete.
 *
 * When start returns the action's state MUST be STARTED.
 *
 * @public
 * @param {http.Agent}  httpAgentPool The HTTP client connection pool to
 * use when making requests to the requested peer.
 * @returns {Promise<?Error>} returns a promise that will resolve when the
 * action is done. Note that if kill is called on an action then it MUST still
 * return success with null. After all, kill doesn't reflect a failure
 * of the action but a change in outside circumstances.
 */
PeerAction.prototype.start = function (httpAgentPool) {
  this.actionState = module.exports.actionState.STARTED;
  return new Promise();
};

/**
 * Tells an action to stop executing immediately and synchronously.
 *
 * If the action is already dead then there is no error. If the action isn't
 * dead then once it is killed off it MUST return null to its promise as defined
 * above.
 *
 * This method is idempotent so multiple calls MUST NOT directly cause a state
 * change.
 *
 * When kill returns the action's state MUST be set to KILLED.
 *
 * It's fine to call kill on an action that has been submitted to a peer pool.
 * When the action is enqueued the peer pool will override the action's kill
 * method with its own kill method that will then call this kill method.
 *
 * @public
 * @returns {?Error}
 */
PeerAction.prototype.kill = function () {
  this.actionState = module.exports.actionState.KILLED;
  return null;
};


/**
 *
 * @returns {*}
 */
PeerAction.prototype.getActionState = function () {
  return this.actionState;
};

module.exports.PeerAction = PeerAction;
