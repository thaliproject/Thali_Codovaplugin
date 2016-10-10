//
//  Thali CordovaPlugin
//  RelayTests.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
//  See LICENSE.txt file in the project root for full license information.
//

import MultipeerConnectivity
@testable import ThaliCore
import XCTest

class RelayTests: XCTestCase {

    // MARK: - State
    var mcPeerID: MCPeerID!
    var mcSessionMock: MCSessionMock!
    var nonTCPSession: Session!

    let randomGeneratedServiceType = String.randomValidServiceType(length: 7)
    let anyAvailablePort: UInt16 = 0

    let streamReceivedTimeout: NSTimeInterval = 5.0
    let openRelayTimeout: NSTimeInterval = 10.0
    let clientConnectTimeout: NSTimeInterval = 5.0
    let clientDisconnectTimeout: NSTimeInterval = 10.0
    let disposeTimeout: NSTimeInterval = 30.0
    let newConnectionTimeout: NSTimeInterval = 10.0
    let browserFindPeerTimeout: NSTimeInterval = 5.0
    let browserConnectTimeout = 5.0


    // MARK: - Setup
    override func setUp() {
        mcPeerID = MCPeerID(displayName: String.random(length: 5))
        mcSessionMock = MCSessionMock(peer: MCPeerID(displayName: String.random(length: 5)))
        nonTCPSession = Session(session: mcSessionMock,
                                identifier: mcPeerID,
                                connected: {},
                                notConnected: {})
    }

    // MARK: - BrowserRelay Tests


//    func testOpenRelayMethodOnAdvertiserReturnsTimeotErrorWhenThereIsNoMPCFSession() {
//        // Given
//        var relayOpenError: XCTestExpectation?
//
//        // Open relay
//        let relay = AdvertiserRelay(with: nonTCPSession,
//                                    createVirtualSocketTimeout: streamReceivedTimeout)
//        relayOpenError = expectationWithDescription("Relay can't be opened")
//
//        // When
//        relay.openRelay(on: randomPort) {
//            port, error in
//
//            XCTAssertNotNil(error)
//            relayOpenError?.fulfill()
//        }
//
//        // Then
//        waitForExpectationsWithTimeout(streamReceivedTimeout) {
//            error in
//            relayOpenError = nil
//        }
//    }

    func testIncomingTCPConnectionCreatesVirtualSocket() {
        XCTFail("implement")
    }

    func testVirtualSocketClosedWhenIncomingTCPConnectionFromNodeClosed() {
        XCTFail("implement")

//        // Given
//        let (am, bm) = testCreateMCSessionBetweenTwoPeers()
//
//
//        var connectedToTCPListenerExpecation: XCTestExpectation? =
//            expectationWithDescription("Connected to TCP Listener")
//        var disconnectedFromTCPListenerExpecation: XCTestExpectation? = nil
//
//        let nodeClientMock = NodeClientMock(connectHandler: {
//                                                connectedToTCPListenerExpecation?.fulfill()
//                                            },
//                                            disconnectHandler: {
//                                                disconnectedFromTCPListenerExpecation?.fulfill()
//                                            })
//
//        nodeClientMock.connectToLocalHost(on: (bm.activeRelays.value.first?.1.listenerPort)!,
//                                          errorHandler: { _ in })
//
//        waitForExpectationsWithTimeout(10) {
//            error in
//            connectedToTCPListenerExpecation = nil
//        }
//
//        disconnectedFromTCPListenerExpecation =
//            expectationWithDescription("Disonnected from TCP Listener")
//
//        // When
//        nodeClientMock.disconnect()
//
//        waitForExpectationsWithTimeout(10) {
//            error in
//            disconnectedFromTCPListenerExpecation = nil
//        }
//
//        // Then
//        // TODO: virtual socket on the other side dies. (but firstly we should test our side)
//        disconnectedFromTCPListenerExpecation =
//            expectationWithDescription("Disonnected from TCP Listener")
//
//        waitForExpectationsWithTimeout(10) {
//            error in
//            disconnectedFromTCPListenerExpecation = nil
//        }
    }

    func testVirtualSocketEndsWhenIncomingTCPConnectionFromNodeEnds() {
        XCTFail("implement")
    }

    func testTCPConnectionClosedWhenVirtualSocketClosed() {
        XCTFail("implement")
    }

    func testTCPConnectionEndsWhenVirtualSocketEnds() {
        XCTFail("implement")
    }

    func testTCPClientClosedWhenVirtualSocketClosed() {
        XCTFail("implement")
    }

    func testTCPClientEndsWhenVirtualSocketEnds() {
        XCTFail("implement")
    }

    func testTCPClientClosesWhenIncomintVirtualSocketCloses() {
        XCTFail("implement")
    }

    func testTCPClientEndsWhenIncomintVirtualSocketEnds() {
        XCTFail("implement")
    }

    func testOpenManyMCSessionsAndMoveData() {
        XCTFail("implement")
    }

    func testOpenManyVirtualSocketsAndMoveData() {
        // Expectations
        var MPCFBrowserFoundAdvertiser: XCTestExpectation?
        var advertisersNodeServerReceivedMessage: XCTestExpectation?
        var browserManagerConnected: XCTestExpectation?

        // Given
        let totalMessagesAmount = 10
        let receivedMessagesAmount = Atomic(0)

        let crlf = "\r\n"
        let fullMessageLength = 10 * 1024
        let plainMessageLength = fullMessageLength - crlf.characters.count
        let randomMessage = String.random(length: plainMessageLength) + crlf

        // Start listening on fake node server
        let advertiserNodeMock =
            TCPServerMock(didAcceptConnection: { },
                          didReadData: {
                              socket, data in

                              let receivedMessage = String(data: data,
                                                           encoding: NSUTF8StringEncoding)
                              XCTAssertEqual(randomMessage,
                                             receivedMessage,
                                             "Received message is wrong")

                              receivedMessagesAmount.modify {
                                  $0 = $0 + 1
                                  print("VALUE IS \($0)")

                                if $0 == totalMessagesAmount {
                                    advertisersNodeServerReceivedMessage?.fulfill()
                                }
                              }
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

        // Start listening for advertisements on browser
        let browserManager = BrowserManager(serviceType: randomGeneratedServiceType,
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

        // Start advertising on advertiser
        let advertiserManager = AdvertiserManager(serviceType: randomGeneratedServiceType,
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
        browserManagerConnected = expectationWithDescription("BrowserManager is connected")

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

        // Creating a bunch of clients, then each of them will send a message
        var browserClients: [TCPClientMock] = []
        for _ in 0..<totalMessagesAmount {
            let browserNodeClientMock = TCPClientMock(didReadData: { _ in },
                                                      didConnect: {},
                                                      didDisconnect: {})

            browserClients.append(browserNodeClientMock)
        }

        // Connect to browser's native TCP listener port
        for i in 0..<totalMessagesAmount {
            let browserClient = browserClients[i]
            browserClient.connectToLocalHost(on: browserNativeTCPListenerPort,
                                                 errorHandler: unexpectedErrorHandler)

            browserClient.send(randomMessage)
        }

        advertisersNodeServerReceivedMessage =
            expectationWithDescription("Advertiser's fake node server received a message")

        waitForExpectationsWithTimeout(20) { // TODO: find all "withtimeout(digit"
            error in
            advertisersNodeServerReceivedMessage = nil
        }
    }
}
