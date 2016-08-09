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
//  THESessionDictionary.m
//

#import "THESessionDictionary.h"

@implementation THESessionDictionary
{
  NSMutableDictionary *_peerIdentifiers;
}

- (instancetype) init
{
  if ((self = [super init]))
  {
    _peerIdentifiers = [[NSMutableDictionary alloc] init];
  }
  return self;
}

- (void)dealloc
{
  for (id peerUUID in _peerIdentifiers) {
    [self updateForPeerUUID:peerUUID
                      updateBlock:^THEMultipeerPeerSession *(THEMultipeerPeerSession *p) {
      if (p.connectionState != THEPeerSessionStateNotConnected)
      {
        [p disconnect];
      }
      assert(p.connectionState == THEPeerSessionStateNotConnected);
      // Since we're enumerating we must return the same object to ensure no
      // mutations take place
      return p;
    }];
  }
}

- (void)updateForPeerID:(MCPeerID *)peerID
           updateBlock:(THEMultipeerPeerSession *(^)(THEMultipeerPeerSession *))updateBlock;
{
  // Wrap the update block in another block
  THEMultipeerPeerSession*(^updateWrapper)(THEMultipeerPeerSession *) = 
    ^THEMultipeerPeerSession *(THEMultipeerPeerSession *v) {

    // Capture the return of the updateBlock so we can maintain a dictionary of
    // peerIdentifier->peerID (the base key type). All this to avoid the possibility
    // of storing duplicate peerIdentifers (which we couldn't do by simply making them the key
    // since the framework doesn't talk to us in those terms)

    // Cache the current peerIdentifier for this session
    NSString *prevPeerUUID = [v remotePeerUUID];
    
    // Carry out the update.. the returned session may be an entirely different
    // one with a different remotePeerIdentifer
    THEMultipeerPeerSession *session = updateBlock(v);

    if (session == nil)
    {
      // session object is being deleted, remove the
      // corresponding mapping for it's peerIdentifier
      [_peerIdentifiers removeObjectForKey:prevPeerUUID];
    }
    else
    {
      // Session object has been updated, it may have been completely replaced
      if (session != v)
      {
        // New session object..
        if ([prevPeerUUID compare:[session remotePeerUUID]] != NSOrderedSame)
        {
          // remove peerIdentifier mapping if it's changed
          [_peerIdentifiers removeObjectForKey:prevPeerUUID];
        }
        
        // Add the new peerIdentifier mapping
        _peerIdentifiers[[session remotePeerUUID]] = peerID;
      }
    }

    return session;
  };

  [super updateForKey:peerID updateBlock:(NSObject *(^)(NSObject *))updateWrapper];  
}

-(void)updateForPeerUUID:(NSString *)peerUUID
                   updateBlock:(THEMultipeerPeerSession *(^)(THEMultipeerPeerSession *))updateBlock;
{
  [self updateForPeerID:_peerIdentifiers[peerUUID] updateBlock:updateBlock];
}

@end

