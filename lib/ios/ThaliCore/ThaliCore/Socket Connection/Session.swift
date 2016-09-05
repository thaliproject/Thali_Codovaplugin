//
//  Thali CordovaPlugin
//  Session.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//

import Foundation
import MultipeerConnectivity

/// Class for managing MCSession: subscribing for incoming streams and creating output streams
class Session: NSObject {

    private let session: MCSession
    private let identifier: MCPeerID
    private var didReceiveInputStream: ((NSInputStream, String) -> Void)?
    private let disconnectHandler: () -> Void
    internal private(set) var sessionState: MCSessionState = .NotConnected

    init(session: MCSession, identifier: MCPeerID, disconnectHandler: () -> Void) {
        self.session = session
        self.identifier = identifier
        self.disconnectHandler = disconnectHandler
        super.init()
        self.session.delegate = self
    }

    func getInputStream(name: String?, completion: (NSInputStream, String) -> Void) {
        //todoo implement
    }

    func createOutputStream(withName name: String,
                            completion: (NSOutputStream?, ErrorType?) -> Void) {
        let createOutputStream = { [weak self] in
            do {
                guard let strongSelf = self else {
                    return
                }
                let stream = try strongSelf.session.startStreamWithName(name, toPeer: strongSelf.identifier)
                completion(stream, nil)
            } catch let error {
                completion(nil, error)
            }
        }
        if self.sessionState == .Connected {
            createOutputStream()
        } else {
            //todo wait for connected state
        }
    }
}

extension Session: MCSessionDelegate {
    func session(session: MCSession, peer peerID: MCPeerID, didChangeState state: MCSessionState) {
        assert(identifier.displayName == peerID.displayName)
        sessionState = state
        switch sessionState {
        case .NotConnected:
            disconnectHandler()
        default:
            break
        }
    }

    func session(session: MCSession, didReceiveStream stream: NSInputStream,
                 withName streamName: String, fromPeer peerID: MCPeerID) {
        assert(identifier.displayName == peerID.displayName)
        didReceiveInputStream?(stream, streamName)
    }

    func session(session: MCSession, didReceiveData data: NSData, fromPeer peerID: MCPeerID) {}
    func session(session: MCSession, didStartReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID, withProgress progress: NSProgress) {}
    func session(session: MCSession, didFinishReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID, atURL localURL: NSURL, withError error: NSError?) {}
}
