//
//  Thali CordovaPlugin
//  TCPListenerTests.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
//  See LICENSE.txt file in the project root for full license information.
//

import XCTest
@testable import ThaliCore

class TCPListenerTests: XCTestCase {

    // MARK: - State
    var randomMessage: String!
    let anyAvailablePort: UInt16 = 0
    let startListeningTimeout: NSTimeInterval = 5.0
    let acceptConnectionTimeout: NSTimeInterval = 5.0
    let readDataTimeout: NSTimeInterval = 5.0
    let disconnectTimeout: NSTimeInterval = 5.0

    // MARK: - Setup
    override func setUp() {
        randomMessage = String.random(length: 100)
    }

    // MARK: - Tests
    func testAcceptNewConnectionHandlerInvoked() {
        // Expectations
        var TCPListenerIsListening: XCTestExpectation?
        var acceptNewConnectionHandlerInvoked: XCTestExpectation?

        // Given
        TCPListenerIsListening = expectationWithDescription("TCP Listener is listenining")

        var listenerPort: UInt16? = nil
        let tcpListener = TCPListener(with: unexpectedReadDataHandler,
                                      socketDisconnected: unexpectedSocketDisconnectHandler)
        tcpListener.startListeningForConnections(
                                        on: anyAvailablePort,
                                        connectionAccepted: {
                                            socket in
                                            acceptNewConnectionHandlerInvoked?.fulfill()
                                        }) {
            port, error in
            XCTAssertNil(error)
            XCTAssertNotNil(port)
            listenerPort = port
            TCPListenerIsListening?.fulfill()
        }

        waitForExpectationsWithTimeout(startListeningTimeout) {
            error in
            TCPListenerIsListening = nil
        }

        acceptNewConnectionHandlerInvoked =
            expectationWithDescription("acceptNewConnectionHandler invoked")

        guard let portToConnect = listenerPort else {
            XCTFail("Listener port is nil")
            return
        }

        // When
        let clientMock = TCPClientMock(didReadData: unexpectedReadDataHandler,
                                       didConnect: {},
                                       didDisconnect: unexpectedDisconnectHandler)

        clientMock.connectToLocalHost(on: portToConnect, errorHandler: { _ in })

        // Then
        waitForExpectationsWithTimeout(acceptConnectionTimeout) {
            error in
            acceptNewConnectionHandlerInvoked = nil
        }
    }

    func testReadDataHandlerInvoked() {
        // Expectations
        var TCPListenerIsListening: XCTestExpectation?
        var acceptNewConnectionHandlerInvoked: XCTestExpectation?
        var readDataHandlerInvoked: XCTestExpectation?

        // Given
        TCPListenerIsListening = expectationWithDescription("TCP Listener is listenining")

        var listenerPort: UInt16? = nil
        let tcpListener = TCPListener(with: {
                                        socket, data in

                                        let receivedMessage = String(data: data,
                                                                     encoding: NSUTF8StringEncoding)
                                        XCTAssertEqual(self.randomMessage,
                                                       receivedMessage,
                                                       "Received message is wrong")
                                        readDataHandlerInvoked?.fulfill()
                                      },
                                      socketDisconnected: unexpectedSocketDisconnectHandler)

        tcpListener.startListeningForConnections(on: anyAvailablePort,
                                                 connectionAccepted: {
                                                     socket in
                                                     socket.readDataWithTimeout(-1, tag: 0)
                                                     acceptNewConnectionHandlerInvoked?.fulfill()
                                                 }) {
            port, error in
            XCTAssertNil(error)
            XCTAssertNotNil(port)
            listenerPort = port
            TCPListenerIsListening?.fulfill()
        }

        waitForExpectationsWithTimeout(acceptConnectionTimeout) {
            error in
            TCPListenerIsListening = nil
        }

        // Connecting to listener with TCP mock client
        acceptNewConnectionHandlerInvoked =
            expectationWithDescription("acceptNewConnectionHandler invoked")

        guard let portToConnect = listenerPort else {
            XCTFail("Listener port is nil")
            return
        }

        let clientMock = TCPClientMock(didReadData: unexpectedReadDataHandler,
                                       didConnect: {},
                                       didDisconnect: unexpectedDisconnectHandler)

        clientMock.connectToLocalHost(on: portToConnect, errorHandler: { _ in })

        waitForExpectationsWithTimeout(acceptConnectionTimeout) {
            error in
            acceptNewConnectionHandlerInvoked = nil
        }

        readDataHandlerInvoked = expectationWithDescription("readDataHandler invoked")

        // When
        clientMock.send(randomMessage)

        // Then
        waitForExpectationsWithTimeout(readDataTimeout) {
            error in
            readDataHandlerInvoked = nil
        }
    }

    func testDisconnectHandlerInvoked() {
        // Expectations
        var TCPListenerIsListening: XCTestExpectation?
        var acceptNewConnectionHandlerInvoked: XCTestExpectation?
        var disconnectHandlerInvoked: XCTestExpectation?

        // Given
        TCPListenerIsListening = expectationWithDescription("TCP Listener is listenining")

        var listenerPort: UInt16? = nil
        let tcpListener = TCPListener(with: { _ in },
                                      socketDisconnected: {
                                          socket in
                                          disconnectHandlerInvoked?.fulfill()
                                      })
        tcpListener.startListeningForConnections(on: anyAvailablePort,
                                                 connectionAccepted: {
                                                     _ in
                                                     acceptNewConnectionHandlerInvoked?.fulfill()
                                                 }) {
            port, error in
            XCTAssertNil(error)
            XCTAssertNotNil(port)
            listenerPort = port
            TCPListenerIsListening?.fulfill()
        }

        waitForExpectationsWithTimeout(startListeningTimeout) {
            error in
            TCPListenerIsListening = nil
        }

        // Connecting to listener with TCP mock client
        acceptNewConnectionHandlerInvoked =
            expectationWithDescription("acceptNewConnectionHandler invoked")

        guard let portToConnect = listenerPort else {
            XCTFail("Listener port is nil")
            return
        }

        let clientMock = TCPClientMock(didReadData: unexpectedReadDataHandler,
                                       didConnect: {},
                                       didDisconnect: {})

        clientMock.connectToLocalHost(on: portToConnect, errorHandler: { _ in })

        waitForExpectationsWithTimeout(acceptConnectionTimeout) {
            error in
            acceptNewConnectionHandlerInvoked = nil
        }

        disconnectHandlerInvoked = expectationWithDescription("disconnectHandler invoked")

        // When
        clientMock.disconnect()

        // Then
        waitForExpectationsWithTimeout(disconnectTimeout) {
            error in
            disconnectHandlerInvoked = nil
        }
    }

    func testTCPListenerCantListenOnBusyPortAndReturnsZeroPort() {
        // Expectations
        var TCPListenerIsListening: XCTestExpectation?
        var TCPListenerCantStartListening: XCTestExpectation?

        // Given
        TCPListenerIsListening =
            expectationWithDescription("TCP Listener is listenining")

        var listenerPort: UInt16? = nil
        let firstTcpListener = TCPListener(with: unexpectedReadDataHandler,
                                           socketDisconnected: unexpectedSocketDisconnectHandler)
        firstTcpListener.startListeningForConnections(on: anyAvailablePort,
                                                      connectionAccepted: { _ in }) {
            port, error in
            XCTAssertNil(error)
            XCTAssertNotNil(port)
            listenerPort = port
            TCPListenerIsListening?.fulfill()
        }

        waitForExpectationsWithTimeout(startListeningTimeout) {
            error in
            TCPListenerIsListening = nil
        }

        guard let busyPort = listenerPort else {
            XCTFail("Listener port is nil")
            return
        }

        // Trying to connect to busy port
        TCPListenerCantStartListening =
            expectationWithDescription("TCP Listener can't start listener")

        let secondTcpListener = TCPListener(with: unexpectedReadDataHandler,
                                            socketDisconnected: { _ in })

        // When
        secondTcpListener.startListeningForConnections(
                                        on: busyPort,
                                        connectionAccepted: { _ in }) {
            port, error in
            XCTAssertNotNil(error)
            XCTAssertEqual(0, port)
            TCPListenerCantStartListening?.fulfill()
        }

        // Then
        waitForExpectationsWithTimeout(startListeningTimeout) {
            error in
            TCPListenerCantStartListening = nil
        }
    }
}

// MARK: - GCDAsyncSocketDelegate
extension TCPListenerTests: GCDAsyncSocketDelegate {

    func socket(sock: GCDAsyncSocket, didConnectToHost host: String, port: UInt16) {}
    func socketDidDisconnect(sock: GCDAsyncSocket, withError err: NSError?) {}
    func socket(sock: GCDAsyncSocket, didWriteDataWithTag tag: Int) {}
    func socketDidCloseReadStream(sock: GCDAsyncSocket) {}
}
