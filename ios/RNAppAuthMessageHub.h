#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

extern NSString *const RNAppAuthMessageDelivered;
extern NSString *const RNAppAuthMessageQueued;
extern NSString *const RNAppAuthMessageUnsupported;

/// Anything able to deliver string messages to the page shown in the authorization browser.
@protocol RNAppAuthMessageTarget <NSObject>
/// YES if this browser can ever exchange messages with the page.
- (BOOL)supportsMessaging;
/// YES once a message can be delivered right now.
- (BOOL)isMessagingReady;
- (BOOL)deliverMessage:(NSString *)message;
@end

/// Main-thread hub between JS, the browser user agents and the event emitter. Messages posted
/// before a browser is open (or before its page is ready) are queued and flushed when ready.
@interface RNAppAuthMessageHub : NSObject

+ (instancetype)sharedHub;

@property (nonatomic, copy, nullable) void (^eventHandler)(NSDictionary *event);

- (void)attachTarget:(id<RNAppAuthMessageTarget>)target mode:(NSString *)mode;
- (void)detachTarget:(id<RNAppAuthMessageTarget>)target;

- (NSString *)postMessage:(NSString *)message;
- (void)clearPendingMessages;
- (void)targetDidBecomeReady:(id<RNAppAuthMessageTarget>)target initialMessages:(NSArray<NSString *> *)initialMessages;

- (void)emit:(NSString *)type mode:(nullable NSString *)mode extras:(nullable NSDictionary *)extras;

@end

/// Placeholder target for user agents that cannot talk to the page (ASWebAuthenticationSession,
/// SFSafariViewController, external browsers): postMessage() resolves 'unsupported' while open.
@interface RNAppAuthNoMessagingTarget : NSObject <RNAppAuthMessageTarget>
@end

NS_ASSUME_NONNULL_END
