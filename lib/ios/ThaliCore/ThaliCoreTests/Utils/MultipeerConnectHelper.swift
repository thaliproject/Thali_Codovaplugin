//
//  Thali CordovaPlugin
//  MultipeerConnectHelper.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
//  See LICENSE.txt file in the project root for full license information.
//

import Foundation
import XCTest
@testable import ThaliCore

func createMPCFConnection(advertiserIdentifier identifier: PeerIdentifier,
                          advertiserSessionHandler: (Session) -> Void,
                          completion: () -> Void) -> (Advertiser, Browser) {
    let serviceType = String.random(length: 7)

    let browser = Browser(serviceType: serviceType, foundPeer: { identifier in
        completion()
        },
                          lostPeer: { _ in })
    browser.startListening() { _ in
    }
    let advertiser = Advertiser(peerIdentifier: identifier,
                                serviceType: serviceType,
                                receivedInvitationHandler: advertiserSessionHandler,
                                disconnectHandler: {})
    advertiser.startAdvertising { _ in}
    return (advertiser, browser)
}

func unexpectedErrorHandler(error: ErrorType) {
    XCTFail("unexpected error: \(error)")
}

func unexpectedDisconnectHandler() {
    XCTFail("Unexpected disconnect received")
}

func unexpectedSessionHandler(session: Session) {
    XCTFail("Unexpected session received: \(session)")
}
