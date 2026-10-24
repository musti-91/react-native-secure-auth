#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

extern NSString *const RNAppAuthModeSystem;
extern NSString *const RNAppAuthModeSafariViewController;
extern NSString *const RNAppAuthModeWebView;

@interface RNAppAuthHeaderButton : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy) NSString *title;
/// 'start' | 'end'
@property (nonatomic, copy) NSString *position;
@end

/// Typed view over the `browser` options produced by `normalizeBrowserOptions()` in JS.
@interface RNAppAuthBrowserOptions : NSObject

@property (nonatomic, copy, readonly) NSString *mode;

// Header (colors are dynamic: they honour `header.dark` in dark mode).
@property (nonatomic, strong, readonly, nullable) UIColor *backgroundColor;
@property (nonatomic, strong, readonly, nullable) UIColor *tintColor;
@property (nonatomic, strong, readonly, nullable) UIColor *titleColor;
@property (nonatomic, strong, readonly, nullable) UIColor *progressColor;
@property (nonatomic, copy, readonly, nullable) NSString *title;
@property (nonatomic, assign, readonly) BOOL showTitle;
@property (nonatomic, assign, readonly) BOOL showUrl;
@property (nonatomic, assign, readonly) BOOL headerHidden;
@property (nonatomic, assign, readonly) BOOL hideUrlBarOnScroll;
@property (nonatomic, assign, readonly) BOOL showProgress;
@property (nonatomic, assign, readonly) UIUserInterfaceStyle interfaceStyle;
@property (nonatomic, copy, readonly) NSString *closeButtonPosition;
@property (nonatomic, copy, readonly) NSString *closeButtonStyle;
@property (nonatomic, copy, readonly, nullable) NSString *closeButtonText;
@property (nonatomic, assign, readonly) BOOL closeButtonHidden;
@property (nonatomic, copy, readonly) NSArray<RNAppAuthHeaderButton *> *buttons;

@property (nonatomic, copy, readonly) NSDictionary<NSString *, NSString *> *headers;
@property (nonatomic, copy, readonly, nullable) NSString *userAgent;

@property (nonatomic, assign, readonly) BOOL messagingEnabled;
@property (nonatomic, copy, readonly) NSArray<NSString *> *initialMessages;
@property (nonatomic, copy, readonly) NSArray<NSString *> *allowedOrigins;

@property (nonatomic, assign, readonly) UIModalPresentationStyle presentationStyle;
@property (nonatomic, assign, readonly) BOOL modalInPresentation;
@property (nonatomic, assign, readonly) BOOL entersReaderIfAvailable;
@property (nonatomic, assign, readonly) BOOL clearWebViewData;
@property (nonatomic, copy, readonly, nullable) NSString *loaderComponent;
@property (nonatomic, strong, readonly, nullable) UIColor *loaderBackgroundColor;
@property (nonatomic, assign, readonly) NSTimeInterval loaderFadeDuration;
@property (nonatomic, copy, readonly) NSArray<NSString *> *allowedHosts;

+ (instancetype)optionsWithDictionary:(nullable NSDictionary *)dictionary;

- (BOOL)isOriginAllowed:(nullable NSString *)origin;
- (BOOL)isHostAllowed:(nullable NSString *)host;

@end

NS_ASSUME_NONNULL_END
