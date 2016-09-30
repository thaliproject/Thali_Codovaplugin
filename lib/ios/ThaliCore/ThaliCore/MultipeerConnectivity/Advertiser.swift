//
//  Thali CordovaPlugin
//  Advertiser.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
//  See LICENSE.txt file in the project root for full license information.
//

import Foundation
import MultipeerConnectivity

final class Advertiser: NSObject {

    // MARK: - Internal state
    internal private(set) var advertising: Bool = false
    internal let peerIdentifier: PeerIdentifier

    // MARK: - Private state
    private let advertiser: MCNearbyServiceAdvertiser
    private let receivedInvitationHandler: (session: Session) -> Void
    private let disconnectHandler: () -> Void
    private var startAdvertisingErrorHandler: (ErrorType -> Void)? = nil

    // MARK: - Public methods
    required init(peerIdentifier: PeerIdentifier,
                  serviceType: String,
                  receivedInvitationHandler: (session: Session) -> Void,
                  disconnectHandler: () -> Void) {

        advertiser = MCNearbyServiceAdvertiser(peer: MCPeerID(peerIdentifier: peerIdentifier),
                                               discoveryInfo:nil,
                                               serviceType: serviceType)
        self.peerIdentifier = peerIdentifier
        self.receivedInvitationHandler = receivedInvitationHandler
        self.disconnectHandler = disconnectHandler
        super.init()
        advertiser.delegate = self
    }

    func startAdvertising(startAdvertisingErrorHandler: ErrorType -> Void) {
        self.startAdvertisingErrorHandler = startAdvertisingErrorHandler
        advertiser.startAdvertisingPeer()
        advertising = true
    }

    func stopAdvertising() {
        advertiser.stopAdvertisingPeer()
        advertising = false
    }
}

// MARK: - MCNearbyServiceAdvertiserDelegate
extension Advertiser: MCNearbyServiceAdvertiserDelegate {

    func advertiser(advertiser: MCNearbyServiceAdvertiser,
                    didReceiveInvitationFromPeer peerID: MCPeerID,
                    withContext context: NSData?,
                    invitationHandler: (Bool, MCSession) -> Void) {

        let mcSession = MCSession(peer: advertiser.myPeerID,
                                  securityIdentity: nil,
                                  encryptionPreference: .None)

        // TODO: https://github.com/thaliproject/Thali_CordovaPlugin/issues/1040
        let session = Session(session: mcSession,
                              identifier: peerID,
                              connectHandler: {},
                              disconnectHandler: disconnectHandler)

        invitationHandler(true, mcSession)
        receivedInvitationHandler(session: session)
    }

    func advertiser(advertiser: MCNearbyServiceAdvertiser,
                    didNotStartAdvertisingPeer error: NSError) {
        advertising = false
        startAdvertisingErrorHandler?(error)
    }
}
