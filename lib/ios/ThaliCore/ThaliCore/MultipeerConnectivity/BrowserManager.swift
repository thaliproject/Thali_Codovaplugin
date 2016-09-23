//
//  Thali CordovaPlugin
//  BrowserManager.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
//  See LICENSE.txt file in the project root for full license information.
//

import Foundation

public struct PeerAvailability {

    public let peerIdentifier: PeerIdentifier
    public let available: Bool

    public init(peerIdentifier: PeerIdentifier, available: Bool) {
        self.peerIdentifier = peerIdentifier
        self.available = available
    }
}

// Class for managing Thali browser's logic
public final class BrowserManager: NSObject {

    private let socketRelay: SocketRelay<BrowserVirtualSocketBuilder>

    internal private(set) var currentBrowser: Browser?
    internal private(set) var availablePeers: Atomic<[PeerIdentifier]> = Atomic([])
    internal private(set) var activeSessions: Atomic<[PeerIdentifier : Session]> = Atomic([:])

    internal let serviceType: String

    private let peersAvailabilityChangedHandler: ([PeerAvailability]) -> Void
    public var listening: Bool {
        return currentBrowser?.listening ?? false
    }

    public init(serviceType: String, inputStreamReceiveTimeout: NSTimeInterval,
                peersAvailabilityChangedHandler: ([PeerAvailability]) -> Void) {
        self.serviceType = serviceType
        self.peersAvailabilityChangedHandler = peersAvailabilityChangedHandler
        socketRelay =
            SocketRelay<BrowserVirtualSocketBuilder>(createSocketTimeout: inputStreamReceiveTimeout)
    }

    private func handleFoundPeer(with identifier: PeerIdentifier) {
        let peerAvailability = PeerAvailability(peerIdentifier: identifier, available: true)
        peersAvailabilityChangedHandler([peerAvailability])
        availablePeers.modify {
            $0.append(identifier)
        }
    }

    private func handleLostPeer(with identifier: PeerIdentifier) {
        let peerAvailability = PeerAvailability(peerIdentifier: identifier, available: false)
        peersAvailabilityChangedHandler([peerAvailability])
        availablePeers.modify {
            if let index = $0.indexOf(identifier) {
                $0.removeAtIndex(index)
            }
        }
    }

    public func startListeningForAdvertisements(errorHandler: ErrorType -> Void) {
        if currentBrowser != nil {
            return
        }
        let browser = Browser(serviceType: serviceType,
                              foundPeer: handleFoundPeer, lostPeer: handleLostPeer)
        browser.startListening(errorHandler)
        self.currentBrowser = browser
    }

    public func stopListeningForAdvertisements() {
        currentBrowser?.stopListening()
        self.currentBrowser = nil
    }

    public func connectToPeer(identifier: PeerIdentifier,
                              completion: (UInt16?, ErrorType?) -> Void) {
        guard let currentBrowser = self.currentBrowser else {
            completion(nil, ThaliCoreError.StartListeningNotActive)
            return
        }
        guard let lastGenerationIdentifier = self.lastGenerationPeer(for: identifier) else {
            completion(nil, ThaliCoreError.IllegalPeerID)
            return
        }
        do {
            let session = try currentBrowser.inviteToConnectPeer(with: lastGenerationIdentifier,
                    disconnectHandler: {
                completion(nil, ThaliCoreError.ConnectionFailed)
            })
            activeSessions.modify {
                $0[identifier] = session
            }
            socketRelay.createSocket(with: session, completion: completion)
        } catch let error {
            completion(nil, error)
        }
    }

    public func disconnect(peerIdentifier: PeerIdentifier) {
        guard let session = activeSessions.value[peerIdentifier] else {
            // There is no active session for current identifier
            return
        }
        session.disconnect()
        activeSessions.modify {
            $0.removeValueForKey(peerIdentifier)
        }
        socketRelay.closeSocket(for: session)
    }

    func lastGenerationPeer(for identifier: PeerIdentifier) -> PeerIdentifier? {
        return availablePeers.withValue {
            $0.filter {
                $0.uuid == identifier.uuid
                }
                .maxElement {
                    $0.0.generation < $0.1.generation
            }
        }
    }
}
