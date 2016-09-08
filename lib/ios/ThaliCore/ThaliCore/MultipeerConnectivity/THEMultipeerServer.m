//
//  THEMultipeerServer.m
//  ThaliCore
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//

#import "THEMultipeerServer.h"
#import "THEMultipeerServerSession.h"
#import "THEMultipeerClientSession.h"

#import "THESessionDictionary.h"

static NSString * const PEER_IDENTIFIER_KEY  = @"PeerIdentifier";

@implementation THEMultipeerServer
{
    // Transport level id
    MCPeerID * _localPeerId;

    // The multipeer service advertiser
    MCNearbyServiceAdvertiser * _nearbyServiceAdvertiser;

    // Application level identifiers
    NSString *_localPeerIdentifier;
    NSString *_serviceType;

    // The port on which the application level is listening
    unsigned short _serverPort;

    // Map of sessions for all the peers we know about
    THESessionDictionary *_serverSessions;

    // Timer reset callback
    void (^_timerCallback)(void);
  
    // Object that will get to hear about peers we 'discover'
    id<THEMultipeerDiscoveryDelegate> _multipeerDiscoveryDelegate;
  
    // Object that can see server session states
    id<THEMultipeerSessionStateDelegate> _sessionStateDelegate;
  
    // Object that will hear about server completed connections
    id<THEMultipeerServerConnectionDelegate> _multipeerServerConnectionDelegate;
}

- (instancetype)initWithPeerID:(MCPeerID *)peerId
                       withPeerIdentifier:(NSString *)peerIdentifier
                          withServiceType:(NSString *)serviceType
                           withServerPort:(unsigned short)serverPort
           withMultipeerDiscoveryDelegate:(id<THEMultipeerDiscoveryDelegate>)multipeerDiscoveryDelegate
                 withSessionStateDelegate:(id<THEMultipeerSessionStateDelegate>)sessionStateDelegate
    withMultipeerServerConnectionDelegate:(id<THEMultipeerServerConnectionDelegate>)multipeerServerConnectionDelegate

{
    self = [super init];
    if (!self)
    {
        return nil;
    }

    // Init the basic multipeer server session
    _localPeerId = peerId;
    _localPeerIdentifier = peerIdentifier;
  
    _serviceType = serviceType;
    _serverPort = serverPort;

    _sessionStateDelegate = sessionStateDelegate;
    _multipeerDiscoveryDelegate = multipeerDiscoveryDelegate;
    _multipeerServerConnectionDelegate = multipeerServerConnectionDelegate;
  
    return self;
}

- (void)setTimerResetCallback:(void (^)(void))timerCallback
{
  _timerCallback = timerCallback;
}

- (void)start
{
  NSLog(@"server: starting %@", _localPeerIdentifier);

  _serverSessions = [[THESessionDictionary alloc] init];

  _nearbyServiceAdvertiser = [[MCNearbyServiceAdvertiser alloc] 
      initWithPeer:_localPeerId 
     discoveryInfo:@{ PEER_IDENTIFIER_KEY: _localPeerIdentifier }
       serviceType:_serviceType
  ];
  [_nearbyServiceAdvertiser setDelegate:self];

  [self startAdvertising];
}

- (void)startAdvertising
{
  // Start advertising our presence.. 
  [_nearbyServiceAdvertiser startAdvertisingPeer];
}

- (void)stop
{
  [_nearbyServiceAdvertiser setDelegate:nil];
  [self stopAdvertising];
  _nearbyServiceAdvertiser = nil;
  _serverSessions = nil;
}

- (void)stopAdvertising
{
  [_nearbyServiceAdvertiser stopAdvertisingPeer];
}

- (void)restart
{
  [self stopAdvertising];
  [self startAdvertising];
}

- (const THEMultipeerServerSession *)sessionForUUID:(NSString *)peerUUID
{
  __block THEMultipeerServerSession *session = nil;
  
  [_serverSessions updateForPeerUUID:peerUUID
                               updateBlock:^THEMultipeerPeerSession *(THEMultipeerPeerSession *p) {

    THEMultipeerServerSession *serverSession = (THEMultipeerServerSession *)p;
    if (serverSession)
    {
      session = serverSession;
    }

    return serverSession;
  }];
  
  return session;
}


// MCNearbyServiceAdvertiserDelegate
////////////////////////////////////

- (void)advertiser:(MCNearbyServiceAdvertiser *)advertiser
    didReceiveInvitationFromPeer:(MCPeerID *)peerID
                     withContext:(NSData *)context
               invitationHandler:(void (^)(BOOL accept, MCSession * session))invitationHandler
{
  __block THEMultipeerServerSession *_serverSession = nil;

  // Any invite at all will reset the timer (since an invite implies we're advertsing
  // correctly).
  if (_timerCallback)
  {
    _timerCallback();
  }
  
  // If context doesn't look right just ignore the invitation.. don't get
  // into an argument with a malfunctioning/hostile peer
  
  if ([context length] > 115)
  {
    NSLog(@"server: rejecting invitation: malformed context");
    return;
  }
  
  // Crack the context into it's constituent parts..
  NSString *stringContext = [[NSString alloc] initWithData:context encoding:NSUTF8StringEncoding];
  NSArray<NSString *> *contextParts = [stringContext componentsSeparatedByString:@"+"];
  if ([contextParts count] != 2)
  {
    NSLog(@"server: context did not parse");
    return;
  }

  NSString *remotePeerIdentifier = contextParts[0];
  NSString *localPeerIdentifier = contextParts[1];
  
  NSString *remotePeerUUID = [THEMultipeerPeerSession peerUUIDFromPeerIdentifier:remotePeerIdentifier];
  NSString *localPeerUUID = [THEMultipeerPeerSession peerUUIDFromPeerIdentifier:localPeerIdentifier];
  
  [_serverSessions updateForPeerID:peerID 
                       updateBlock:^THEMultipeerPeerSession *(THEMultipeerPeerSession *p) {

    THEMultipeerServerSession *serverSession = (THEMultipeerServerSession *)p;
    
    if (serverSession && ([[serverSession remotePeerID] hash] == [peerID hash]))
    {
      assert([remotePeerUUID compare:[serverSession remotePeerUUID]] == NSOrderedSame);
      
      // Disconnect any existing session, see note below
      NSLog(@"server: disconnecting to refresh session (%@)", [serverSession remotePeerUUID]);
      [serverSession disconnect];
    }
    else
    {
      serverSession = [[THEMultipeerServerSession alloc] initWithLocalPeerID:_localPeerId
                                                            withRemotePeerID:peerID
                                                    withRemotePeerIdentifier:remotePeerIdentifier
                                                              withServerPort:_serverPort];
    }

    _serverSession = serverSession;
    return serverSession;
  }];

  if ([_localPeerIdentifier compare:localPeerIdentifier] != NSOrderedSame)
  {
    // Remote is trying to connect to a previous generation of us, reject
    NSLog(
      @"server: rejecting invitation from %@ due to previous generation (%@ != %@)",
      remotePeerUUID, _localPeerIdentifier, localPeerIdentifier
    );
    invitationHandler(NO, [_serverSession session]);
    return;
  }

  if ([localPeerUUID compare:remotePeerUUID] == NSOrderedDescending)
  {
    NSLog(@"server: rejecting invitation for lexical ordering %@", remotePeerUUID);
    invitationHandler(NO, [_serverSession session]);
    [_multipeerDiscoveryDelegate didFindPeerIdentifier:remotePeerIdentifier pleaseConnect:true];
    return;
  }

  [_serverSession connectWithConnectCallback:^void(NSString *p, unsigned short c, unsigned short s) {
    [_multipeerServerConnectionDelegate didCompleteReverseConnection:p
                                                      withClientPort:c
                                                      withServerPort:s];
  }];

  NSLog(@"server: accepting invitation %@", remotePeerUUID);
  invitationHandler(YES, [_serverSession session]);
}

- (void)advertiser:(MCNearbyServiceAdvertiser *)advertiser didNotStartAdvertisingPeer:(NSError *)error
{
    NSLog(@"WARNING: server didNotStartAdvertisingPeer");
}

@end
