#import <UIKit/UIKit.h>
#if __has_include(<AppAuth/AppAuth.h>)
#import <AppAuth/AppAuth.h>
#else
#import "AppAuth.h"
#endif
#import "RNAppAuthBrowserOptions.h"

NS_ASSUME_NONNULL_BEGIN

/// Common surface of the user agents implemented by this library.
@protocol RNAppAuthUserAgent <OIDExternalUserAgent>
@property (nonatomic, copy, readonly) NSString *mode;
@end

/// ASWebAuthenticationSession user agent. Unlike AppAuth's default agent it reports
/// opened/closed events and, on iOS 17.4+, sends `browser.headers` with the first request
/// and supports https (universal link) callbacks.
@interface RNAppAuthWebAuthenticationSessionUserAgent : NSObject <RNAppAuthUserAgent>
- (instancetype)initWithPresentingViewController:(UIViewController *)presentingViewController
                                     redirectURL:(nullable NSURL *)redirectURL
                                       ephemeral:(BOOL)ephemeral
                                         options:(RNAppAuthBrowserOptions *)options;
@end

/// SFSafariViewController user agent with header (bar/control tint, dismiss button) customization.
@interface RNAppAuthSafariUserAgent : NSObject <RNAppAuthUserAgent>
- (instancetype)initWithPresentingViewController:(UIViewController *)presentingViewController
                                         options:(RNAppAuthBrowserOptions *)options;
@end

/// WKWebView user agent with a fully customizable native header and a two-way message bridge.
@interface RNAppAuthWebViewUserAgent : NSObject <RNAppAuthUserAgent>
- (instancetype)initWithPresentingViewController:(UIViewController *)presentingViewController
                                     redirectURL:(nullable NSURL *)redirectURL
                                         options:(RNAppAuthBrowserOptions *)options;
+ (void)clearWebViewDataWithCompletion:(nullable void (^)(void))completion;
@end

/// Forwards a redirect to an AppAuth session (works with AppAuth 1.x - 3.x).
BOOL RNAppAuthResumeSession(id<OIDExternalUserAgentSession> _Nullable session, NSURL *_Nullable url);

/// Microsoft Edge custom browser (`iosCustomBrowser: 'edge'`).
OIDExternalUserAgentIOSCustomBrowser *RNAppAuthCustomBrowserEdge(void);

NS_ASSUME_NONNULL_END
