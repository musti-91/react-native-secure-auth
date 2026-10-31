#import "RNAppAuthBrowserOptions.h"
#import <React/RCTConvert.h>

NSString *const RNAppAuthModeSystem = @"system";
NSString *const RNAppAuthModeSafariViewController = @"safariViewController";
NSString *const RNAppAuthModeWebView = @"webView";

static id RNAppAuthValue(NSDictionary *dictionary, NSString *key, Class cls) {
    id value = dictionary[key];
    return [value isKindOfClass:cls] ? value : nil;
}

static BOOL RNAppAuthBool(NSDictionary *dictionary, NSString *key, BOOL fallback) {
    NSNumber *value = RNAppAuthValue(dictionary, key, [NSNumber class]);
    return value != nil ? value.boolValue : fallback;
}

static NSArray<NSString *> *RNAppAuthStrings(NSDictionary *dictionary, NSString *key) {
    NSArray *values = RNAppAuthValue(dictionary, key, [NSArray class]);
    NSMutableArray<NSString *> *strings = [NSMutableArray array];
    for (id value in values) {
        if ([value isKindOfClass:[NSString class]]) {
            [strings addObject:value];
        }
    }
    return strings;
}

static UIColor *RNAppAuthColor(NSDictionary *light, NSDictionary *dark, NSString *key) {
    id lightValue = light[key];
    id darkValue = dark[key];
    UIColor *lightColor = [lightValue isKindOfClass:[NSNumber class]] ? [RCTConvert UIColor:lightValue] : nil;
    UIColor *darkColor = [darkValue isKindOfClass:[NSNumber class]] ? [RCTConvert UIColor:darkValue] : nil;
    if (darkColor == nil) {
        return lightColor;
    }
    UIColor *fallback = lightColor;
    return [UIColor colorWithDynamicProvider:^UIColor *(UITraitCollection *traits) {
        if (traits.userInterfaceStyle == UIUserInterfaceStyleDark) {
            return darkColor;
        }
        return fallback ?: darkColor;
    }];
}

static BOOL RNAppAuthPatternMatches(NSString *pattern, NSString *value) {
    NSString *lowerPattern = pattern.lowercaseString;
    NSString *lowerValue = value.lowercaseString;
    if ([lowerPattern isEqualToString:@"*"] || [lowerPattern isEqualToString:lowerValue]) {
        return YES;
    }
    // "*.example.com" or "https://*.example.com"
    NSRange wildcard = [lowerPattern rangeOfString:@"*."];
    if (wildcard.location == NSNotFound) {
        return NO;
    }
    NSString *prefix = [lowerPattern substringToIndex:wildcard.location];
    NSString *suffix = [lowerPattern substringFromIndex:wildcard.location + 1];
    return [lowerValue hasPrefix:prefix] && [lowerValue hasSuffix:suffix] &&
        lowerValue.length > prefix.length + suffix.length;
}

@implementation RNAppAuthHeaderButton
@end

@implementation RNAppAuthBrowserOptions

+ (instancetype)optionsWithDictionary:(NSDictionary *)dictionary {
    return [[self alloc] initWithDictionary:[dictionary isKindOfClass:[NSDictionary class]] ? dictionary : @{}];
}

- (instancetype)initWithDictionary:(NSDictionary *)dictionary {
    if ((self = [super init])) {
        _mode = RNAppAuthValue(dictionary, @"mode", [NSString class]) ?: RNAppAuthModeSystem;

        NSDictionary *header = RNAppAuthValue(dictionary, @"header", [NSDictionary class]) ?: @{};
        NSDictionary *dark = RNAppAuthValue(header, @"dark", [NSDictionary class]) ?: @{};
        _backgroundColor = RNAppAuthColor(header, dark, @"backgroundColor");
        _tintColor = RNAppAuthColor(header, dark, @"tintColor");
        _titleColor = RNAppAuthColor(header, dark, @"titleColor");
        _progressColor = RNAppAuthColor(header, dark, @"progressColor");
        _title = RNAppAuthValue(header, @"title", [NSString class]);
        _showTitle = RNAppAuthBool(header, @"showTitle", YES);
        _showUrl = RNAppAuthBool(header, @"showUrl", NO);
        _headerHidden = RNAppAuthBool(header, @"hidden", NO);
        _hideUrlBarOnScroll = RNAppAuthBool(header, @"hideUrlBarOnScroll", NO);
        _showProgress = RNAppAuthBool(header, @"showProgress", YES);

        NSString *scheme = RNAppAuthValue(header, @"colorScheme", [NSString class]);
        _interfaceStyle = [scheme isEqualToString:@"dark"] ? UIUserInterfaceStyleDark
            : [scheme isEqualToString:@"light"] ? UIUserInterfaceStyleLight
            : UIUserInterfaceStyleUnspecified;

        NSDictionary *close = RNAppAuthValue(header, @"closeButton", [NSDictionary class]) ?: @{};
        _closeButtonPosition = RNAppAuthValue(close, @"position", [NSString class]) ?: @"start";
        _closeButtonStyle = RNAppAuthValue(close, @"style", [NSString class]) ?: @"close";
        _closeButtonText = RNAppAuthValue(close, @"text", [NSString class]);
        _closeButtonHidden = RNAppAuthBool(close, @"hidden", NO);

        NSMutableArray<RNAppAuthHeaderButton *> *buttons = [NSMutableArray array];
        for (id raw in RNAppAuthValue(header, @"buttons", [NSArray class])) {
            if (![raw isKindOfClass:[NSDictionary class]]) {
                continue;
            }
            NSString *identifier = RNAppAuthValue(raw, @"id", [NSString class]);
            NSString *title = RNAppAuthValue(raw, @"title", [NSString class]);
            if (identifier == nil || title == nil) {
                continue;
            }
            RNAppAuthHeaderButton *button = [RNAppAuthHeaderButton new];
            button.identifier = identifier;
            button.title = title;
            button.position = RNAppAuthValue(raw, @"position", [NSString class]) ?: @"end";
            [buttons addObject:button];
        }
        _buttons = buttons;

        NSMutableDictionary<NSString *, NSString *> *headers = [NSMutableDictionary dictionary];
        NSDictionary *rawHeaders = RNAppAuthValue(dictionary, @"headers", [NSDictionary class]);
        [rawHeaders enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
            if ([key isKindOfClass:[NSString class]] && [value isKindOfClass:[NSString class]]) {
                headers[key] = value;
            }
        }];
        _headers = headers;
        _userAgent = RNAppAuthValue(dictionary, @"userAgent", [NSString class]);

        NSDictionary *messaging = RNAppAuthValue(dictionary, @"messaging", [NSDictionary class]) ?: @{};
        _messagingEnabled = RNAppAuthBool(messaging, @"enabled", [_mode isEqualToString:RNAppAuthModeWebView]);
        NSString *bridgeName = RNAppAuthValue(messaging, @"bridgeName", [NSString class]);
        NSRegularExpression *identifier = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z_$][A-Za-z0-9_$]*$" options:0 error:nil];
        BOOL validName = bridgeName.length > 0 &&
            [identifier numberOfMatchesInString:bridgeName options:0 range:NSMakeRange(0, bridgeName.length)] == 1;
        _messagingBridgeName = validName ? [bridgeName copy] : @"RNAppAuth";
        _initialMessages = RNAppAuthStrings(messaging, @"initialMessages");
        _allowedOrigins = RNAppAuthStrings(messaging, @"allowedOrigins");

        NSString *style = RNAppAuthValue(dictionary, @"presentationStyle", [NSString class]);
        NSDictionary<NSString *, NSNumber *> *styles = @{
            @"automatic": @(UIModalPresentationAutomatic),
            @"fullScreen": @(UIModalPresentationFullScreen),
            @"pageSheet": @(UIModalPresentationPageSheet),
            @"formSheet": @(UIModalPresentationFormSheet),
            @"overFullScreen": @(UIModalPresentationOverFullScreen),
            @"popover": @(UIModalPresentationPopover),
        };
        _presentationStyle = style && styles[style] ? (UIModalPresentationStyle)styles[style].integerValue
                                                    : UIModalPresentationAutomatic;
        _modalInPresentation = RNAppAuthBool(dictionary, @"modalInPresentation", NO);
        _entersReaderIfAvailable = RNAppAuthBool(dictionary, @"entersReaderIfAvailable", NO);
        _clearWebViewData = RNAppAuthBool(dictionary, @"clearWebViewData", NO);
        NSDictionary *loader = RNAppAuthValue(dictionary, @"loader", [NSDictionary class]);
        _loaderComponent = RNAppAuthValue(loader, @"component", [NSString class]);
        id loaderColor = loader[@"backgroundColor"];
        _loaderBackgroundColor = [loaderColor isKindOfClass:[NSNumber class]] ? [RCTConvert UIColor:loaderColor] : nil;
        NSNumber *fade = RNAppAuthValue(loader, @"fadeDuration", [NSNumber class]);
        _loaderFadeDuration = fade ? fade.doubleValue / 1000.0 : 0.2;
        _allowedHosts = RNAppAuthStrings(dictionary, @"allowedHosts");
    }
    return self;
}

- (BOOL)isOriginAllowed:(NSString *)origin {
    if (self.allowedOrigins.count == 0) {
        return YES;
    }
    if (origin.length == 0) {
        return NO;
    }
    for (NSString *pattern in self.allowedOrigins) {
        if (RNAppAuthPatternMatches(pattern, origin)) {
            return YES;
        }
    }
    return NO;
}

- (BOOL)isHostAllowed:(NSString *)host {
    if (self.allowedHosts.count == 0 || host.length == 0) {
        return YES;
    }
    for (NSString *pattern in self.allowedHosts) {
        if (RNAppAuthPatternMatches(pattern, host)) {
            return YES;
        }
    }
    return NO;
}

@end
