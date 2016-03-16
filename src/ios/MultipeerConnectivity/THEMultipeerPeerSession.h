//
//  The MIT License (MIT)
//
//  Copyright (c) 2015 Microsoft
//
//  Permission is hereby granted, free of charge, to any person obtaining a copy
//  of this software and associated documentation files (the "Software"), to deal
//  in the Software without restriction, including without limitation the rights
//  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//  copies of the Software, and to permit persons to whom the Software is
//  furnished to do so, subject to the following conditions:
//
//  The above copyright notice and this permission notice shall be included in
//  all copies or substantial portions of the Software.
//
//  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//  THE SOFTWARE.
//
//  Thali CordovaPlugin
//  THEMultipeerSession.h
//

#import <MultipeerConnectivity/MultipeerConnectivity.h>

#import "THEMultipeerSocketRelay.h"

typedef NS_ENUM(NSUInteger, THEPeerSessionState) {
  THEPeerSessionStateNotConnected  = 0,
  THEPeerSessionStateConnecting    = 1,
  THEPeerSessionStateConnected     = 2
};

// Encapsulates a discovered peer, their connection state and resources.
// Any peer that has been discovered  will have a MultipeerPeerSession object although 
// they may not currently be visible or connected. 
// The underlying connection transport may be any available e.g. Bluetooth, WiFi etc.
@interface THEMultipeerPeerSession : NSObject <MCSessionDelegate>

- (instancetype)initWithLocalPeerID:(MCPeerID *)localPeerID 
                   withRemotePeerID:(MCPeerID *)remotePeerID
           withRemotePeerIdentifier:(NSString *)peerIdentifier
                    withSessionType:(NSString *)sessionType;

- (MCPeerID *)remotePeerID;
- (NSString *)remotePeerUUID;
- (NSString *)remotePeerIdentifier;
- (THEPeerSessionState)connectionState;

- (void)updateRemotePeerIdentifier:(NSString *)remotePeerIdentifier;

- (MCSession *)session;

- (void)connect;
- (void)reverseConnect;

- (void)disconnect;

// Kill for testing only !!
- (void)kill;

// Called when the p2p link fails
- (void)onLinkFailure;

// Accessor for the relay
- (const THEMultipeerSocketRelay *)relay;

+ (NSString *)peerUUIDFromPeerIdentifier:(NSString *)peerIdentifier;

- (void)changeState:(THEPeerSessionState)newState;

@end

