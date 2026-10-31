#import "RNAppAuthMessageHub.h"

NSString *const RNAppAuthMessageDelivered = @"delivered";
NSString *const RNAppAuthMessageQueued = @"queued";
NSString *const RNAppAuthMessageNotOpen = @"notOpen";
NSString *const RNAppAuthMessageUnsupported = @"unsupported";

@implementation RNAppAuthMessageHub {
    NSMutableArray<NSString *> *_pending;
    __weak id<RNAppAuthMessageTarget> _target;
    NSString *_mode;
}

+ (instancetype)sharedHub {
    static RNAppAuthMessageHub *hub;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        hub = [RNAppAuthMessageHub new];
    });
    return hub;
}

- (instancetype)init {
    if ((self = [super init])) {
        _pending = [NSMutableArray array];
    }
    return self;
}

- (void)attachTarget:(id<RNAppAuthMessageTarget>)target mode:(NSString *)mode {
    _target = target;
    _mode = [mode copy];
}

- (void)detachTarget:(id<RNAppAuthMessageTarget>)target {
    if (_target == target) {
        _target = nil;
        _mode = nil;
    }
}

- (NSString *)postMessage:(NSString *)message {
    id<RNAppAuthMessageTarget> target = _target;
    if (target != nil && ![target supportsMessaging]) {
        return RNAppAuthMessageUnsupported;
    }
    if (target != nil && [target isMessagingReady] && _pending.count == 0) {
        return [target deliverMessage:message] ? RNAppAuthMessageDelivered : RNAppAuthMessageUnsupported;
    }
    [_pending addObject:message];
    return RNAppAuthMessageQueued;
}

- (NSString *)postMessageNow:(NSString *)message {
    id<RNAppAuthMessageTarget> target = _target;
    if (target == nil || ([target supportsMessaging] && ![target isMessagingReady])) {
        return RNAppAuthMessageNotOpen;
    }
    if (![target supportsMessaging]) {
        return RNAppAuthMessageUnsupported;
    }
    return [target deliverMessage:message] ? RNAppAuthMessageDelivered : RNAppAuthMessageNotOpen;
}

- (void)clearPendingMessages {
    [_pending removeAllObjects];
}

- (void)targetDidBecomeReady:(id<RNAppAuthMessageTarget>)target initialMessages:(NSArray<NSString *> *)initialMessages {
    if (target != _target) {
        return;
    }
    for (NSString *message in initialMessages) {
        [target deliverMessage:message];
    }
    while (_pending.count > 0 && [target isMessagingReady]) {
        NSString *message = _pending.firstObject;
        if (![target deliverMessage:message]) {
            break;
        }
        [_pending removeObjectAtIndex:0];
    }
}

- (void)emit:(NSString *)type mode:(NSString *)mode extras:(NSDictionary *)extras {
    NSMutableDictionary *event = extras ? [extras mutableCopy] : [NSMutableDictionary dictionary];
    event[@"type"] = type;
    NSString *resolvedMode = mode ?: _mode;
    if (resolvedMode != nil && event[@"mode"] == nil) {
        event[@"mode"] = resolvedMode;
    }
    void (^handler)(NSDictionary *) = self.eventHandler;
    if (handler == nil) {
        return;
    }
    if ([NSThread isMainThread]) {
        handler(event);
    } else {
        dispatch_async(dispatch_get_main_queue(), ^{
            handler(event);
        });
    }
}

@end

@implementation RNAppAuthNoMessagingTarget

- (BOOL)supportsMessaging {
    return NO;
}

- (BOOL)isMessagingReady {
    return NO;
}

- (BOOL)deliverMessage:(NSString *)message {
    return NO;
}

@end
