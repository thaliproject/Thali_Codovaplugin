//
//  Thali CordovaPlugin
//  AdvertiserRelayTests.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
//  See LICENSE.txt file in the project root for full license information.
//

import MultipeerConnectivity
@testable import ThaliCore
import XCTest

class AdvertiserRelayTests: XCTestCase {

    // MARK: - State
    var mcPeerID: MCPeerID!
    var mcSessionMock: MCSessionMock!
    var nonTCPSession: Session!

    var randomlyGeneratedServiceType: String!
    var randomMessage: String!
    var anyAvailablePort: UInt16 = 0

    let browserFindPeerTimeout: NSTimeInterval = 5.0
    let browserConnectTimeout: NSTimeInterval = 5.0
    let streamReceivedTimeout: NSTimeInterval = 5.0
    let disposeTimeout: NSTimeInterval = 30.0
    let receiveMessageTimeout: NSTimeInterval = 10.0


    // MARK: - Setup
    override func setUp() {
        mcPeerID = MCPeerID(displayName: String.random(length: 5))
        mcSessionMock = MCSessionMock(peer: MCPeerID(displayName: String.random(length: 5)))
        nonTCPSession = Session(session: mcSessionMock,
                                identifier: mcPeerID,
                                connected: {},
                                notConnected: {})

        randomlyGeneratedServiceType = String.randomValidServiceType(length: 7)

        let crlf = "\r\n"
        let fullMessageLength = 10 * 1024
        let plainMessageLength = fullMessageLength - crlf.characters.count
        randomMessage = String.random(length: plainMessageLength) + crlf
    }

    // MARK: - Tests
    func testCloseRelayMethodDisconnectsTCPClient() {
        //        // Expectations
        //        var TCPClientConnectedToMockServer: XCTestExpectation?
        //        var TCPClientDisconnectedFromMockServer: XCTestExpectation?
        //
        //        // Given
        //        // start fake server
        //        let serverMock = TCPServerMock(didAcceptConnection: {
        //                                           TCPClientConnectedToMockServer?.fulfill()
        //                                       },
        //                                       didReadData: { _ in },
        //                                       didDisconnect: {
        //                                           TCPClientDisconnectedFromMockServer?.fulfill()
        //                                       })
        //        let listenerPort = serverMock.startListening()
        //
        //
        //        // Open relay
        //        TCPClientConnectedToMockServer =
        //            expectationWithDescription("TCPClient accepted on listener")
        //        let relay = AdvertiserRelay(with: nonTCPSession,
        //                                    on: listenerPort)
        //
        //        waitForExpectationsWithTimeout(openRelayTimeout) {
        //            error in
        //            TCPClientConnectedToMockServer = nil
        //        }
        //
        //        TCPClientDisconnectedFromMockServer =
        //            expectationWithDescription("Disconnect on listener invoked")
        //
        //        // When
        //        // Close relay
        //        relay.closeRelay { _ in }
        //
        //        waitForExpectationsWithTimeout(clientDisconnectTimeout) {
        //            error in
        //            TCPClientDisconnectedFromMockServer = nil
        //        }
    }

    func testMoveDataThrouhgRelayFromBrowserToAdvertiserUsingTCP() {
        // Expectations
        var advertisersNodeServerReceivedMessage: XCTestExpectation?
        var MPCFBrowserFoundAdvertiser: XCTestExpectation?
        var browserManagerConnected: XCTestExpectation?

        // Given
        // Start listening on fake node server
        let advertiserNodeMock =
            TCPServerMock(didAcceptConnection: { },
                          didReadData: {
                              [weak self] socket, data in
                              guard let strongSelf = self else { return }

                              let receivedMessage = String(
                                  data: data,
                                  encoding: NSUTF8StringEncoding
                              )
                              XCTAssertEqual(strongSelf.randomMessage,
                                             receivedMessage,
                                             "Received message is wrong")

                              advertisersNodeServerReceivedMessage?.fulfill()
                          },
                          didDisconnect: unexpectedDisconnectHandler)
        var advertiserNodeListenerPort: UInt16 = 0
        do {
            advertiserNodeListenerPort = try advertiserNodeMock.startListening(on: anyAvailablePort)
        } catch {
            XCTFail("Can't start listening on fake node server")
        }

        // Prepare pair of advertiser and browser
        MPCFBrowserFoundAdvertiser =
            expectationWithDescription("Browser peer found Advertiser peer")

        // Start listening for advertisements on Browser's side
        let browserManager = BrowserManager(serviceType: randomlyGeneratedServiceType,
                                            inputStreamReceiveTimeout: streamReceivedTimeout,
                                            peersAvailabilityChangedHandler: {
                                                peerAvailability in

                                                guard let peer = peerAvailability.first else {
                                                    XCTFail("Browser didn't find Advertiser peer")
                                                    return
                                                }
                                                XCTAssertTrue(peer.available)
                                                MPCFBrowserFoundAdvertiser?.fulfill()
                                            })
        browserManager.startListeningForAdvertisements(unexpectedErrorHandler)

        // Start advertising on Advertiser's side
        let advertiserManager = AdvertiserManager(serviceType: randomlyGeneratedServiceType,
                                                  disposeAdvertiserTimeout: disposeTimeout)
        advertiserManager.startUpdateAdvertisingAndListening(onPort: advertiserNodeListenerPort,
                                                             errorHandler: unexpectedErrorHandler)

        waitForExpectationsWithTimeout(browserFindPeerTimeout) {
            error in
            MPCFBrowserFoundAdvertiser = nil
        }

        // Create MCsession between browser and adveriser
        // Then get TCP listener port from browser manager
        guard let peerToConnect = browserManager.availablePeers.value.first else {
            XCTFail("BrowserManager does not have available peers to connect")
            return
        }

        // Connect method invocation
        browserManagerConnected =
            expectationWithDescription("BrowserManager is connected")

        var browserNativeTCPListenerPort: UInt16 = 0
        browserManager.connectToPeer(peerToConnect, syncValue: "0") {
            syncValue, error, port in

            guard let port = port else {
                XCTFail("Port must not be nil")
                return
            }

            browserNativeTCPListenerPort = port
            browserManagerConnected?.fulfill()
        }

        waitForExpectationsWithTimeout(browserConnectTimeout) {
            error in
            browserManagerConnected = nil
        }

        // Check if relay objectes are valid
        guard
            let browserRelayInfo: (uuid: String, relay: BrowserRelay) =
                browserManager.activeRelays.value.first,
            let advertiserRelayInfo: (uuid: String, relay: AdvertiserRelay) =
                advertiserManager.activeRelays.value.first
            else {
                return
        }

        guard browserRelayInfo.uuid == advertiserRelayInfo.uuid else {
            XCTFail("MPCF Connection is not valid")
            return
        }

        XCTAssertEqual(advertiserRelayInfo.relay.virtualSocketsAmount,
                       0,
                       "BrowserRelay must not have active virtual sockets")

        // Connect to browser's native TCP listener port
        let browserNodeClientMock = TCPClientMock(didReadData: { _ in },
                                                  didConnect: {},
                                                  didDisconnect: {})

        browserNodeClientMock.connectToLocalHost(on: browserNativeTCPListenerPort,
                                                 errorHandler: { _ in })

        // When
        // Send message from advertiser's node mock server to browser's node mock client
        advertisersNodeServerReceivedMessage =
            expectationWithDescription("Advertiser's fake node server received a message")
        browserNodeClientMock.send(self.randomMessage)

        // Then
        waitForExpectationsWithTimeout(receiveMessageTimeout) {
            error in
            advertisersNodeServerReceivedMessage = nil
        }
    }
}
