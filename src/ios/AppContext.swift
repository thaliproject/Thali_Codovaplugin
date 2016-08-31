//
//  Thali CordovaPlugin
//  AppContext.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//

import Foundation
import ThaliCore

func jsonValue(object: AnyObject) throws -> String? {
    let data = try NSJSONSerialization.dataWithJSONObject(object, options: NSJSONWritingOptions(rawValue:0))
    return String(data: data, encoding: NSUTF8StringEncoding)
}

public typealias ClientConnectCallback = (String, String) -> Void

@objc public enum AppContextError: Int, ErrorType{
    case BadParameters
    case UnknownError
}

@objc public protocol AppContextDelegate: class, NSObjectProtocol {
    /**
     Notifies about context's peer changes

     - parameter peers:   json with data about changed peers
     - parameter context: related AppContext
     */
    func context(context: AppContext, didChangePeerAvailability peers: String)

    /**
     Notifies about network status changes

     - parameter status:  json string with network availability status
     - parameter context: related AppContext
     */
    func context(context: AppContext, didChangeNetworkStatus status: String)

    /**
     Notifies about peer advertisement update

     - parameter discoveryAdvertisingState: json with information about peer's state
     - parameter context:                   related AppContext
     */
    func context(context: AppContext, didUpdateDiscoveryAdvertisingState discoveryAdvertisingState: String)

    /**
     Notifies about failing connection to port

     - parameter port:      port failed to connect
     - parameter context: related AppContext
     */
    func context(context: AppContext, didFailIncomingConnectionToPort port: UInt16)

    /**
     Notifies about entering background

     - parameter context: related AppContext
     */
    func appWillEnterBackground(withContext context: AppContext)

    /**
     Notifies about entering foreground

     - parameter context: related AppContext
     */
    func appDidEnterForeground(withContext context: AppContext)
}

/// Interface for communication between native and cross-platform parts
@objc public final class AppContext: NSObject {
    /// delegate for AppContext's events
    public weak var delegate: AppContextDelegate?
    private let appNotificationsManager: ApplicationStateNotificationsManager
    private var networkChangedRegistered: Bool = false

    private func notifyOnDidUpdateNetworkStatus() {
        //todo put actual network status
        do {
            delegate?.context(self, didChangeNetworkStatus: try jsonValue([:])!)
        } catch let error {
            assert(false, "\(error)")
        }
    }

    public override init() {
        appNotificationsManager = ApplicationStateNotificationsManager()
        super.init()
        appNotificationsManager.didEnterForegroundHandler = { [weak self] in
            guard let strongSelf = self else {
                return
            }
            strongSelf.delegate?.appDidEnterForeground(withContext: strongSelf)
        }
        appNotificationsManager.willEnterBackgroundHandler = { [weak self] in
            guard let strongSelf = self else {
                return
            }
            strongSelf.delegate?.appWillEnterBackground(withContext: strongSelf)
        }
    }

    public func startListeningForAdvertisements() throws {
    }

    public func stopListeningForAdvertisements() throws {
    }

    public func startUpdateAdvertisingAndListening(withParameters parameters: [AnyObject]) throws {
        guard let _ = (parameters.first as? NSNumber)?.unsignedShortValue where parameters.count == 2 else {
            throw AppContextError.BadParameters
        }
    }

    public func stopListening() throws {
    }

    public func stopAdvertisingAndListening() throws {
    }

    public func multiConnectToPeer(parameters: [AnyObject]) throws {

    }

    public func killConnection(parameters: [AnyObject]) throws {
    }

    public func getIOSVersion() -> String {
        return NSProcessInfo().operatingSystemVersionString
    }

    public func didRegisterToNative(parameters: [AnyObject]) throws {
        guard let functionName = parameters.first as? String where parameters.count == 2 else {
            throw AppContextError.BadParameters
        }
        if functionName == AppContextJSEvent.networkChanged {
            notifyOnDidUpdateNetworkStatus()
        }
    }


#if TEST
    func executeNativeTests() -> String {
        let runner = TestRunner.`default`
        runner.runTest()
        return runner.resultDescription ?? ""
    }
#endif

}

/// Node functions names
@objc public class AppContextJSEvent: NSObject {
    @objc public static let networkChanged: String = "networkChanged"
    @objc public static let peerAvailabilityChanged: String = "peerAvailabilityChanged"
    @objc public static let appEnteringBackground: String = "appEnteringBackground"
    @objc public static let appEnteredForeground: String = "appEnteredForeground"
    @objc public static let discoveryAdvertisingStateUpdateNonTCP: String = "discoveryAdvertisingStateUpdateNonTCP"
    @objc public static let incomingConnectionToPortNumberFailed: String = "incomingConnectionToPortNumberFailed"
    @objc public static let executeNativeTests: String = "executeNativeTests"
    @objc public static let getOSVersion: String = "getOSVersion"
    @objc public static let didRegisterToNative: String = "didRegisterToNative"
    @objc public static let killConnections: String = "killConnections"
    @objc public static let connect: String = "connect"
    @objc public static let stopAdvertisingAndListening: String = "stopAdvertisingAndListening"
    @objc public static let startUpdateAdvertisingAndListening: String = "startUpdateAdvertisingAndListening"
    @objc public static let stopListeningForAdvertisements: String = "stopListeningForAdvertisements"
    @objc public static let startListeningForAdvertisements: String = "startListeningForAdvertisements"
}
