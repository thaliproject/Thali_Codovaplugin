//
//  Thali CordovaPlugin
//  BrowserManagerTests.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//

import XCTest
@testable import ThaliCore

class BrowserManagerTests: XCTestCase {
    var browser: BrowserManager!

    override func setUp() {
        let serviceType = String.random(length: 7)
        browser = BrowserManager(serviceType: serviceType)
    }

    override func tearDown() {
        browser = nil
    }

    func testStopBrowsing() {
        browser.startListeningForAdvertisements()
        XCTAssertNotNil(browser.currentBrowser)
        XCTAssertTrue(browser.isListening)
        browser.stopListeningForAdvertisements()
        XCTAssertNil(browser.currentBrowser)
        XCTAssertFalse(browser.isListening)
    }

    func testStartListeningNotActive() {
        let expectation = expectationWithDescription("got startListening not active error")
        var connectError: MultiСonnectError?
        browser.connectToPeer(PeerIdentifier()) { [weak expectation] port, error in
            if let error = error as? MultiСonnectError {
                connectError = error
                expectation?.fulfill()
            }
        }
        waitForExpectationsWithTimeout(5, handler: nil)
        XCTAssertEqual(connectError, .StartListeningNotActive)
    }

    func testIllegalPeer() {
        let expectation = expectationWithDescription("got Illegal Peer")
        var connectError: MultiСonnectError?
        browser.startListeningForAdvertisements()
        browser.connectToPeer(PeerIdentifier()) { [weak expectation] port, error in
            if let error = error as? MultiСonnectError {
                connectError = error
                expectation?.fulfill()
            }
        }
        waitForExpectationsWithTimeout(5, handler: nil)
        XCTAssertEqual(connectError, .IllegalPeerID)
    }
}
