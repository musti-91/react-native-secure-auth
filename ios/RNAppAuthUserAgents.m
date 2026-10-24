#import "RNAppAuthUserAgents.h"
#import "RNAppAuthMessageHub.h"
#import <AuthenticationServices/AuthenticationServices.h>
#import <SafariServices/SafariServices.h>
#import <WebKit/WebKit.h>

static NSString *const RNAppAuthNativeHandlerName = @"RNAppAuthNative";

static NSString *const RNAppAuthBridgeScript =
    @"(function(){"
     "if(window.RNAppAuth&&window.RNAppAuth.__installed){return;}"
     "var h=window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.RNAppAuthNative;"
     "if(!h){return;}"
     "function send(m){h.postMessage(typeof m==='string'?m:JSON.stringify(m));}"
     "window.RNAppAuth={__installed:true,isEmbedded:true,platform:'ios',postMessage:send,onmessage:null};"
     "if(!window.ReactNativeWebView){window.ReactNativeWebView={postMessage:send};}"
     "try{window.dispatchEvent(new Event('rnappauthready'));}catch(e){}"
     "})();";

static NSError *RNAppAuthUserCancelledError(NSError *underlying) {
    return [OIDErrorUtilities errorWithCode:OIDErrorCodeUserCanceledAuthorizationFlow
                            underlyingError:underlying
                                description:@"The user closed the browser."];
}

static BOOL RNAppAuthIsRedirect(NSURL *url, NSURL *redirectURL, NSString *fallbackScheme) {
    if (url == nil) {
        return NO;
    }
    if (redirectURL == nil) {
        return fallbackScheme.length > 0 && [url.scheme caseInsensitiveCompare:fallbackScheme] == NSOrderedSame;
    }
    if (url.scheme == nil || [url.scheme caseInsensitiveCompare:redirectURL.scheme] != NSOrderedSame) {
        return NO;
    }
    NSString *host = url.host ?: @"";
    NSString *redirectHost = redirectURL.host ?: @"";
    if ([host caseInsensitiveCompare:redirectHost] != NSOrderedSame) {
        return NO;
    }
    if ((url.port ?: @0).integerValue != (redirectURL.port ?: @0).integerValue) {
        return NO;
    }
    NSString *path = url.path.length ? url.path : @"/";
    NSString *redirectPath = redirectURL.path.length ? redirectURL.path : @"/";
    return [path isEqualToString:redirectPath];
}

static NSString *RNAppAuthOrigin(NSString *scheme, NSString *host, NSInteger port) {
    if (scheme.length == 0 || host.length == 0) {
        return nil;
    }
    NSString *origin = [NSString stringWithFormat:@"%@://%@", scheme.lowercaseString, host.lowercaseString];
    BOOL defaultPort = port <= 0 || ([scheme isEqualToString:@"https"] && port == 443) ||
        ([scheme isEqualToString:@"http"] && port == 80);
    return defaultPort ? origin : [origin stringByAppendingFormat:@":%ld", (long)port];
}

static NSString *RNAppAuthJSONString(NSString *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:@[value ?: @""] options:0 error:nil];
    NSString *array = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return [array substringWithRange:NSMakeRange(1, array.length - 2)];
}

static UIWindow *RNAppAuthAnchorWindow(UIViewController *presenting) {
    if (presenting.view.window != nil) {
        return presenting.view.window;
    }
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) {
            continue;
        }
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            if (window.isKeyWindow) {
                return window;
            }
        }
    }
    return [UIWindow new];
}

OIDExternalUserAgentIOSCustomBrowser *RNAppAuthCustomBrowserEdge(void) {
    OIDCustomBrowserURLTransformation transform =
        [OIDExternalUserAgentIOSCustomBrowser URLTransformationSchemeSubstitutionHTTPS:@"microsoft-edge-https"
                                                                                  HTTP:@"microsoft-edge-http"];
    return [[OIDExternalUserAgentIOSCustomBrowser alloc]
        initWithURLTransformation:transform
                 canOpenURLScheme:@"microsoft-edge-https"
                      appStoreURL:[NSURL URLWithString:@"https://apps.apple.com/app/microsoft-edge/id1288723196"]];
}

BOOL RNAppAuthResumeSession(id<OIDExternalUserAgentSession> session, NSURL *url) {
    if (session == nil || url == nil) {
        return NO;
    }
    // AppAuth >= 3 replaces resumeExternalUserAgentFlowWithURL: with a non-throwing error variant.
    SEL errorVariant = NSSelectorFromString(@"resumeExternalUserAgentFlowWithURL:error:");
    if ([session respondsToSelector:errorVariant]) {
        NSError *error = nil;
        BOOL (*resume)(id, SEL, NSURL *, NSError **) = (BOOL (*)(id, SEL, NSURL *, NSError **))[(NSObject *)session methodForSelector:errorVariant];
        return resume(session, errorVariant, url, &error);
    }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    return [session resumeExternalUserAgentFlowWithURL:url];
#pragma clang diagnostic pop
}

#pragma mark - ASWebAuthenticationSession

@interface RNAppAuthWebAuthenticationSessionUserAgent () <ASWebAuthenticationPresentationContextProviding>
@end

@implementation RNAppAuthWebAuthenticationSessionUserAgent {
    __weak UIViewController *_presentingViewController;
    NSURL *_redirectURL;
    BOOL _ephemeral;
    RNAppAuthBrowserOptions *_options;
    ASWebAuthenticationSession *_authenticationSession;
    __weak id<OIDExternalUserAgentSession> _session;
    RNAppAuthNoMessagingTarget *_target;
    BOOL _inProgress;
}

- (instancetype)initWithPresentingViewController:(UIViewController *)presentingViewController
                                     redirectURL:(NSURL *)redirectURL
                                       ephemeral:(BOOL)ephemeral
                                         options:(RNAppAuthBrowserOptions *)options {
    if ((self = [super init])) {
        _presentingViewController = presentingViewController;
        _redirectURL = redirectURL;
        _ephemeral = ephemeral;
        _options = options;
    }
    return self;
}

- (NSString *)mode {
    return RNAppAuthModeSystem;
}

- (BOOL)presentExternalUserAgentRequest:(id<OIDExternalUserAgentRequest>)request
                                session:(id<OIDExternalUserAgentSession>)session {
    if (_inProgress) {
        return NO;
    }
    _inProgress = YES;
    _session = session;

    NSURL *url = [request externalUserAgentRequestURL];
    NSString *scheme = [request redirectScheme];
    __weak typeof(self) weakSelf = self;
    ASWebAuthenticationSessionCompletionHandler handler = ^(NSURL *callbackURL, NSError *error) {
        typeof(self) strongSelf = weakSelf;
        if (strongSelf == nil) {
            return;
        }
        id<OIDExternalUserAgentSession> flow = strongSelf->_session;
        [strongSelf cleanUp];
        if (callbackURL != nil) {
            RNAppAuthResumeSession(flow, callbackURL);
        } else {
            [flow failExternalUserAgentFlowWithError:RNAppAuthUserCancelledError(error)];
        }
    };

    ASWebAuthenticationSession *authenticationSession = nil;
    if (@available(iOS 17.4, *)) {
        ASWebAuthenticationSessionCallback *callback;
        if ([scheme caseInsensitiveCompare:@"https"] == NSOrderedSame && _redirectURL.host.length > 0) {
            callback = [ASWebAuthenticationSessionCallback callbackWithHTTPSHost:_redirectURL.host
                                                                            path:_redirectURL.path.length ? _redirectURL.path : @"/"];
        } else {
            callback = [ASWebAuthenticationSessionCallback callbackWithCustomScheme:scheme];
        }
        authenticationSession = [[ASWebAuthenticationSession alloc] initWithURL:url
                                                                       callback:callback
                                                              completionHandler:handler];
        if (_options.headers.count > 0) {
            authenticationSession.additionalHeaderFields = _options.headers;
        }
    } else {
        authenticationSession = [[ASWebAuthenticationSession alloc] initWithURL:url
                                                              callbackURLScheme:scheme
                                                              completionHandler:handler];
    }
    authenticationSession.presentationContextProvider = self;
    authenticationSession.prefersEphemeralWebBrowserSession = _ephemeral;
    _authenticationSession = authenticationSession;

    _target = [RNAppAuthNoMessagingTarget new];
    [[RNAppAuthMessageHub sharedHub] attachTarget:_target mode:self.mode];
    if (![authenticationSession start]) {
        [self cleanUp];
        return NO;
    }
    [[RNAppAuthMessageHub sharedHub] emit:@"opened" mode:self.mode extras:@{@"url": url.absoluteString ?: @""}];
    return YES;
}

- (void)dismissExternalUserAgentAnimated:(BOOL)animated completion:(void (^)(void))completion {
    if (!_inProgress) {
        if (completion) completion();
        return;
    }
    ASWebAuthenticationSession *authenticationSession = _authenticationSession;
    [self cleanUp];
    [authenticationSession cancel];
    if (completion) completion();
}

- (void)cleanUp {
    if (!_inProgress) {
        return;
    }
    _inProgress = NO;
    _session = nil;
    _authenticationSession = nil;
    if (_target != nil) {
        [[RNAppAuthMessageHub sharedHub] detachTarget:_target];
        _target = nil;
    }
    [[RNAppAuthMessageHub sharedHub] emit:@"closed" mode:self.mode extras:nil];
}

- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {
    return RNAppAuthAnchorWindow(_presentingViewController);
}

@end

#pragma mark - SFSafariViewController

@interface RNAppAuthSafariUserAgent () <SFSafariViewControllerDelegate, UIAdaptivePresentationControllerDelegate>
@end

@implementation RNAppAuthSafariUserAgent {
    __weak UIViewController *_presentingViewController;
    RNAppAuthBrowserOptions *_options;
    SFSafariViewController *_safariViewController;
    __weak id<OIDExternalUserAgentSession> _session;
    RNAppAuthNoMessagingTarget *_target;
    BOOL _inProgress;
}

- (instancetype)initWithPresentingViewController:(UIViewController *)presentingViewController
                                         options:(RNAppAuthBrowserOptions *)options {
    if ((self = [super init])) {
        _presentingViewController = presentingViewController;
        _options = options;
    }
    return self;
}

- (NSString *)mode {
    return RNAppAuthModeSafariViewController;
}

- (BOOL)presentExternalUserAgentRequest:(id<OIDExternalUserAgentRequest>)request
                                session:(id<OIDExternalUserAgentSession>)session {
    UIViewController *presenting = _presentingViewController;
    if (_inProgress || presenting == nil) {
        return NO;
    }
    _inProgress = YES;
    _session = session;

    SFSafariViewControllerConfiguration *configuration = [SFSafariViewControllerConfiguration new];
    configuration.entersReaderIfAvailable = _options.entersReaderIfAvailable;
    configuration.barCollapsingEnabled = _options.hideUrlBarOnScroll;

    NSURL *url = [request externalUserAgentRequestURL];
    SFSafariViewController *safari = [[SFSafariViewController alloc] initWithURL:url configuration:configuration];
    safari.delegate = self;
    if (_options.backgroundColor) safari.preferredBarTintColor = _options.backgroundColor;
    if (_options.tintColor) safari.preferredControlTintColor = _options.tintColor;
    NSString *style = _options.closeButtonStyle;
    safari.dismissButtonStyle = [style isEqualToString:@"cancel"] ? SFSafariViewControllerDismissButtonStyleCancel
        : [style isEqualToString:@"close"] ? SFSafariViewControllerDismissButtonStyleClose
        : SFSafariViewControllerDismissButtonStyleDone;
    safari.overrideUserInterfaceStyle = _options.interfaceStyle;
    if (_options.presentationStyle != UIModalPresentationAutomatic) {
        safari.modalPresentationStyle = _options.presentationStyle;
    }
    safari.modalInPresentation = _options.modalInPresentation;
    safari.presentationController.delegate = self;
    _safariViewController = safari;

    _target = [RNAppAuthNoMessagingTarget new];
    [[RNAppAuthMessageHub sharedHub] attachTarget:_target mode:self.mode];
    NSString *mode = self.mode;
    [presenting presentViewController:safari animated:YES completion:^{
        [[RNAppAuthMessageHub sharedHub] emit:@"opened" mode:mode extras:@{@"url": url.absoluteString ?: @""}];
    }];
    return YES;
}

- (void)dismissExternalUserAgentAnimated:(BOOL)animated completion:(void (^)(void))completion {
    if (!_inProgress) {
        if (completion) completion();
        return;
    }
    SFSafariViewController *safari = _safariViewController;
    [self cleanUp];
    if (safari.presentingViewController != nil) {
        [safari dismissViewControllerAnimated:animated completion:completion];
    } else if (completion) {
        completion();
    }
}

- (void)cleanUp {
    if (!_inProgress) {
        return;
    }
    _inProgress = NO;
    _session = nil;
    _safariViewController = nil;
    if (_target != nil) {
        [[RNAppAuthMessageHub sharedHub] detachTarget:_target];
        _target = nil;
    }
    [[RNAppAuthMessageHub sharedHub] emit:@"closed" mode:self.mode extras:nil];
}

- (void)userDidCancel {
    if (!_inProgress) {
        return;
    }
    id<OIDExternalUserAgentSession> session = _session;
    [self cleanUp];
    [session failExternalUserAgentFlowWithError:RNAppAuthUserCancelledError(nil)];
}

- (void)safariViewControllerDidFinish:(SFSafariViewController *)controller {
    if (controller == _safariViewController) {
        [self userDidCancel];
    }
}

- (void)safariViewController:(SFSafariViewController *)controller didCompleteInitialLoad:(BOOL)didLoadSuccessfully {
    [[RNAppAuthMessageHub sharedHub] emit:didLoadSuccessfully ? @"navigationFinished" : @"navigationFailed"
                                     mode:self.mode
                                   extras:nil];
}

- (void)safariViewController:(SFSafariViewController *)controller initialLoadDidRedirectToURL:(NSURL *)URL {
    [[RNAppAuthMessageHub sharedHub] emit:@"navigationStarted" mode:self.mode extras:@{@"url": URL.absoluteString ?: @""}];
}

- (void)presentationControllerDidDismiss:(UIPresentationController *)presentationController {
    [self userDidCancel];
}

@end

#pragma mark - WKWebView

@interface RNAppAuthWeakScriptMessageHandler : NSObject <WKScriptMessageHandler>
@property (nonatomic, weak) id<WKScriptMessageHandler> delegate;
@end

@implementation RNAppAuthWeakScriptMessageHandler
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    [self.delegate userContentController:controller didReceiveScriptMessage:message];
}
@end

@interface RNAppAuthWebViewController : UIViewController <WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler,
                                                          UIAdaptivePresentationControllerDelegate, RNAppAuthMessageTarget>
@property (nonatomic, copy) void (^onRedirect)(NSURL *url);
@property (nonatomic, copy) void (^onCancel)(void);
- (instancetype)initWithURL:(NSURL *)url
                redirectURL:(NSURL *)redirectURL
             redirectScheme:(NSString *)redirectScheme
                    options:(RNAppAuthBrowserOptions *)options;
@end

@implementation RNAppAuthWebViewController {
    NSURL *_initialURL;
    NSURL *_redirectURL;
    NSString *_redirectScheme;
    RNAppAuthBrowserOptions *_options;
    WKWebView *_webView;
    UIProgressView *_progressView;
    UILabel *_titleLabel;
    UILabel *_urlLabel;
    UIView *_loaderView;
    BOOL _pageReady;
    BOOL _channelAnnounced;
    BOOL _observing;
    BOOL _finished;
}

- (instancetype)initWithURL:(NSURL *)url
                redirectURL:(NSURL *)redirectURL
             redirectScheme:(NSString *)redirectScheme
                    options:(RNAppAuthBrowserOptions *)options {
    if ((self = [super initWithNibName:nil bundle:nil])) {
        _initialURL = url;
        _redirectURL = redirectURL;
        _redirectScheme = [redirectScheme copy];
        _options = options;
    }
    return self;
}

- (void)dealloc {
    [self tearDownWebView];
}

- (void)tearDownWebView {
    if (_observing) {
        [_webView removeObserver:self forKeyPath:@"estimatedProgress"];
        [_webView removeObserver:self forKeyPath:@"title"];
        [_webView removeObserver:self forKeyPath:@"URL"];
        _observing = NO;
    }
    [_webView.configuration.userContentController removeScriptMessageHandlerForName:RNAppAuthNativeHandlerName];
    _webView.navigationDelegate = nil;
    _webView.UIDelegate = nil;
    [_webView stopLoading];
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = _options.backgroundColor ?: UIColor.systemBackgroundColor;

    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    if (_options.messagingEnabled) {
        WKUserContentController *contentController = [WKUserContentController new];
        WKUserScript *script = [[WKUserScript alloc] initWithSource:RNAppAuthBridgeScript
                                                      injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                   forMainFrameOnly:YES];
        [contentController addUserScript:script];
        RNAppAuthWeakScriptMessageHandler *handler = [RNAppAuthWeakScriptMessageHandler new];
        handler.delegate = self;
        [contentController addScriptMessageHandler:handler name:RNAppAuthNativeHandlerName];
        configuration.userContentController = contentController;
    }

    _webView = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:configuration];
    _webView.translatesAutoresizingMaskIntoConstraints = NO;
    _webView.navigationDelegate = self;
    _webView.UIDelegate = self;
    _webView.allowsBackForwardNavigationGestures = YES;
    if (_options.userAgent.length > 0) {
        _webView.customUserAgent = _options.userAgent;
    }
    [self.view addSubview:_webView];

    _progressView = [[UIProgressView alloc] initWithProgressViewStyle:UIProgressViewStyleBar];
    _progressView.translatesAutoresizingMaskIntoConstraints = NO;
    _progressView.progressTintColor = _options.progressColor ?: _options.tintColor;
    _progressView.hidden = !_options.showProgress;
    [self.view addSubview:_progressView];

    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [_webView.topAnchor constraintEqualToAnchor:safe.topAnchor],
        [_webView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [_webView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [_webView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
        [_progressView.topAnchor constraintEqualToAnchor:safe.topAnchor],
        [_progressView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [_progressView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
    ]];

    [_webView addObserver:self forKeyPath:@"estimatedProgress" options:NSKeyValueObservingOptionNew context:nil];
    [_webView addObserver:self forKeyPath:@"title" options:NSKeyValueObservingOptionNew context:nil];
    [_webView addObserver:self forKeyPath:@"URL" options:NSKeyValueObservingOptionNew context:nil];
    _observing = YES;

    [self configureHeader];
    [self showLoader];

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:_initialURL];
    [_options.headers enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSString *value, BOOL *stop) {
        [request setValue:value forHTTPHeaderField:key];
    }];
    [_webView loadRequest:request];
}

#pragma mark Loader

// Hosts a React surface (rendered from JS) over the web view until the first page has loaded.
// The root view factory is looked up (via KVC, `@objc` for Swift) on the app delegate and on the
// scene delegates: `reactNativeFactory.rootViewFactory` (RCTReactNativeFactory) or `rootViewFactory`.
- (id)findRootViewFactory {
    NSMutableArray *candidates = [NSMutableArray array];
    id appDelegate = UIApplication.sharedApplication.delegate;
    if (appDelegate) {
        [candidates addObject:appDelegate];
    }
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (scene.delegate) {
            [candidates addObject:scene.delegate];
        }
    }
    for (id candidate in candidates) {
        id owner = candidate;
        if ([candidate respondsToSelector:NSSelectorFromString(@"reactNativeFactory")]) {
            owner = [candidate valueForKey:@"reactNativeFactory"] ?: candidate;
        }
        if ([owner respondsToSelector:NSSelectorFromString(@"rootViewFactory")]) {
            id factory = [owner valueForKey:@"rootViewFactory"];
            if (factory) {
                return factory;
            }
        }
    }
    return nil;
}

- (UIView *)createLoaderViewWithComponent:(NSString *)component {
    id factory = [self findRootViewFactory];
    SEL selector = NSSelectorFromString(@"viewWithModuleName:initialProperties:");
    if (factory == nil || ![factory respondsToSelector:selector]) {
        return nil;
    }
    UIView *(*create)(id, SEL, NSString *, NSDictionary *) = (UIView * (*)(id, SEL, NSString *, NSDictionary *))
        [factory methodForSelector:selector];
    return create(factory, selector, component, @{});
}

- (void)showLoader {
    if (_options.loaderComponent.length == 0) {
        return;
    }
    UIView *loader = [self createLoaderViewWithComponent:_options.loaderComponent];
    if (loader == nil) {
        NSLog(@"[RNAppAuth] Loader skipped: no React root view factory found on the app or scene delegates.");
        return;
    }
    loader.translatesAutoresizingMaskIntoConstraints = NO;
    loader.backgroundColor = _options.loaderBackgroundColor ?: (_options.backgroundColor ?: UIColor.systemBackgroundColor);
    [self.view addSubview:loader];
    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [loader.topAnchor constraintEqualToAnchor:safe.topAnchor],
        [loader.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [loader.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [loader.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
    ]];
    _loaderView = loader;
}

- (void)hideLoader {
    UIView *loader = _loaderView;
    if (loader == nil) {
        return;
    }
    _loaderView = nil;
    [UIView animateWithDuration:_options.loaderFadeDuration
        animations:^{ loader.alpha = 0; }
        completion:^(BOOL finished) { [loader removeFromSuperview]; }];
}

#pragma mark Header

- (void)configureHeader {
    UINavigationController *navigation = self.navigationController;
    navigation.navigationBarHidden = _options.headerHidden;
    navigation.hidesBarsOnSwipe = _options.hideUrlBarOnScroll;
    navigation.overrideUserInterfaceStyle = _options.interfaceStyle;

    UINavigationBarAppearance *appearance = [UINavigationBarAppearance new];
    if (_options.backgroundColor) {
        [appearance configureWithOpaqueBackground];
        appearance.backgroundColor = _options.backgroundColor;
    } else {
        [appearance configureWithDefaultBackground];
    }
    if (_options.titleColor) {
        appearance.titleTextAttributes = @{NSForegroundColorAttributeName: _options.titleColor};
    }
    UINavigationBar *bar = navigation.navigationBar;
    bar.standardAppearance = appearance;
    bar.scrollEdgeAppearance = appearance;
    bar.compactAppearance = appearance;
    if (_options.tintColor) {
        bar.tintColor = _options.tintColor;
    }

    if (_options.showUrl) {
        _titleLabel = [UILabel new];
        _titleLabel.font = [UIFont systemFontOfSize:15 weight:UIFontWeightSemibold];
        _titleLabel.textColor = _options.titleColor ?: UIColor.labelColor;
        _titleLabel.textAlignment = NSTextAlignmentCenter;
        _urlLabel = [UILabel new];
        _urlLabel.font = [UIFont systemFontOfSize:11];
        _urlLabel.textColor = _options.titleColor ? [_options.titleColor colorWithAlphaComponent:0.7] : UIColor.secondaryLabelColor;
        _urlLabel.textAlignment = NSTextAlignmentCenter;
        UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:@[_titleLabel, _urlLabel]];
        stack.axis = UILayoutConstraintAxisVertical;
        stack.alignment = UIStackViewAlignmentCenter;
        self.navigationItem.titleView = stack;
    }
    [self updateTitle];

    NSMutableArray<UIBarButtonItem *> *start = [NSMutableArray array];
    NSMutableArray<UIBarButtonItem *> *end = [NSMutableArray array];
    if (!_options.closeButtonHidden) {
        UIBarButtonItem *close = [self closeButtonItem];
        [[_options.closeButtonPosition isEqualToString:@"end"] ? end : start addObject:close];
    }
    for (NSUInteger index = 0; index < _options.buttons.count; index++) {
        RNAppAuthHeaderButton *button = _options.buttons[index];
        UIBarButtonItem *item = [[UIBarButtonItem alloc] initWithTitle:button.title
                                                                 style:UIBarButtonItemStylePlain
                                                                target:self
                                                                action:@selector(headerButtonPressed:)];
        item.tag = (NSInteger)index;
        item.accessibilityIdentifier = button.identifier;
        [[button.position isEqualToString:@"start"] ? start : end addObject:item];
    }
    self.navigationItem.leftBarButtonItems = start;
    // Right items are laid out from the trailing edge inwards.
    self.navigationItem.rightBarButtonItems = end.reverseObjectEnumerator.allObjects;
}

- (UIBarButtonItem *)closeButtonItem {
    if (_options.closeButtonText.length > 0) {
        return [[UIBarButtonItem alloc] initWithTitle:_options.closeButtonText
                                                style:UIBarButtonItemStylePlain
                                               target:self
                                               action:@selector(closePressed)];
    }
    NSString *style = _options.closeButtonStyle;
    if ([style isEqualToString:@"back"]) {
        UIImage *image = [UIImage systemImageNamed:@"chevron.backward"];
        UIBarButtonItem *item = [[UIBarButtonItem alloc] initWithImage:image
                                                                 style:UIBarButtonItemStylePlain
                                                                target:self
                                                                action:@selector(closePressed)];
        item.accessibilityLabel = @"Back";
        return item;
    }
    UIBarButtonSystemItem system = [style isEqualToString:@"done"] ? UIBarButtonSystemItemDone
        : [style isEqualToString:@"cancel"] ? UIBarButtonSystemItemCancel
        : UIBarButtonSystemItemClose;
    return [[UIBarButtonItem alloc] initWithBarButtonSystemItem:system target:self action:@selector(closePressed)];
}

- (void)updateTitle {
    NSString *title = _options.showTitle ? (_options.title ?: _webView.title ?: @"") : @"";
    if (_titleLabel != nil) {
        _titleLabel.text = title;
        _titleLabel.hidden = title.length == 0;
        _urlLabel.text = _webView.URL.host ?: _initialURL.host;
    } else {
        self.navigationItem.title = title;
    }
}

- (void)closePressed {
    [self cancelFlow];
}

- (void)headerButtonPressed:(UIBarButtonItem *)sender {
    if (sender.tag < 0 || (NSUInteger)sender.tag >= _options.buttons.count) {
        return;
    }
    RNAppAuthHeaderButton *button = _options.buttons[(NSUInteger)sender.tag];
    [[RNAppAuthMessageHub sharedHub] emit:@"headerButtonPress"
                                     mode:RNAppAuthModeWebView
                                   extras:@{@"buttonId": button.identifier,
                                            @"url": _webView.URL.absoluteString ?: @""}];
}

- (void)cancelFlow {
    if (_finished) {
        return;
    }
    _finished = YES;
    if (self.onCancel) self.onCancel();
}

- (void)completeWithRedirect:(NSURL *)url {
    if (_finished) {
        return;
    }
    _finished = YES;
    [_webView stopLoading];
    if (self.onRedirect) self.onRedirect(url);
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
    if ([keyPath isEqualToString:@"estimatedProgress"]) {
        float progress = (float)_webView.estimatedProgress;
        [_progressView setProgress:progress animated:progress > _progressView.progress];
        BOOL done = progress >= 1.0f;
        [UIView animateWithDuration:0.25 animations:^{
            self->_progressView.alpha = done ? 0 : 1;
        }];
        if (done) {
            _progressView.progress = 0;
        }
    } else {
        [self updateTitle];
    }
}

- (void)presentationControllerDidDismiss:(UIPresentationController *)presentationController {
    [self cancelFlow];
}

#pragma mark Messaging

- (NSString *)currentOrigin {
    NSURL *url = _webView.URL;
    return RNAppAuthOrigin(url.scheme, url.host, url.port.integerValue);
}

- (BOOL)supportsMessaging {
    return _options.messagingEnabled;
}

- (BOOL)isMessagingReady {
    return _options.messagingEnabled && _pageReady && !_finished && [_options isOriginAllowed:[self currentOrigin]];
}

- (BOOL)deliverMessage:(NSString *)message {
    if (![self isMessagingReady]) {
        return NO;
    }
    NSString *script = [NSString stringWithFormat:
        @"(function(){var d=%@;var e;"
         "try{e=new MessageEvent('message',{data:d,origin:'react-native'});}"
         "catch(_){e=document.createEvent('MessageEvent');e.initMessageEvent('message',false,false,d,'react-native','',window);}"
         "window.dispatchEvent(e);"
         "if(window.RNAppAuth&&typeof window.RNAppAuth.onmessage==='function'){window.RNAppAuth.onmessage(e);}"
         "})();",
        RNAppAuthJSONString(message)];
    [_webView evaluateJavaScript:script completionHandler:nil];
    return YES;
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.name isEqualToString:RNAppAuthNativeHandlerName] || _finished) {
        return;
    }
    WKSecurityOrigin *securityOrigin = message.frameInfo.securityOrigin;
    NSString *origin = RNAppAuthOrigin(securityOrigin.protocol, securityOrigin.host, securityOrigin.port);
    if (![_options isOriginAllowed:origin]) {
        return;
    }
    NSString *data;
    if ([message.body isKindOfClass:[NSString class]]) {
        data = message.body;
    } else if ([NSJSONSerialization isValidJSONObject:message.body]) {
        NSData *json = [NSJSONSerialization dataWithJSONObject:message.body options:0 error:nil];
        data = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    } else {
        data = [message.body description];
    }
    [[RNAppAuthMessageHub sharedHub] emit:@"message"
                                     mode:RNAppAuthModeWebView
                                   extras:@{@"data": data ?: @"",
                                            @"origin": origin ?: @"",
                                            @"url": _webView.URL.absoluteString ?: @""}];
}

#pragma mark Navigation

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    if (RNAppAuthIsRedirect(url, _redirectURL, _redirectScheme)) {
        decisionHandler(WKNavigationActionPolicyCancel);
        [self completeWithRedirect:url];
        return;
    }
    NSString *scheme = url.scheme.lowercaseString ?: @"";
    NSArray<NSString *> *webSchemes = @[@"http", @"https", @"about", @"data", @"blob", @"javascript"];
    if (![webSchemes containsObject:scheme]) {
        decisionHandler(WKNavigationActionPolicyCancel);
        [UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
        return;
    }
    BOOL mainFrame = navigationAction.targetFrame == nil || navigationAction.targetFrame.isMainFrame;
    if (mainFrame && ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) &&
        ![_options isHostAllowed:url.host]) {
        decisionHandler(WKNavigationActionPolicyCancel);
        [UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
    _pageReady = NO;
    [[RNAppAuthMessageHub sharedHub] emit:@"navigationStarted"
                                     mode:RNAppAuthModeWebView
                                   extras:@{@"url": webView.URL.absoluteString ?: @""}];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    if (_finished) {
        return;
    }
    [self hideLoader];
    [[RNAppAuthMessageHub sharedHub] emit:@"navigationFinished"
                                     mode:RNAppAuthModeWebView
                                   extras:@{@"url": webView.URL.absoluteString ?: @""}];
    if (!_options.messagingEnabled) {
        return;
    }
    _pageReady = YES;
    if (![self isMessagingReady]) {
        return;
    }
    if (!_channelAnnounced) {
        _channelAnnounced = YES;
        [[RNAppAuthMessageHub sharedHub] emit:@"messageChannelReady"
                                         mode:RNAppAuthModeWebView
                                       extras:@{@"origin": [self currentOrigin] ?: @""}];
    }
    [[RNAppAuthMessageHub sharedHub] targetDidBecomeReady:self initialMessages:_options.initialMessages];
}

- (void)handleNavigationError:(NSError *)error {
    NSURL *failingURL = error.userInfo[NSURLErrorFailingURLErrorKey];
    if (RNAppAuthIsRedirect(failingURL, _redirectURL, _redirectScheme)) {
        [self completeWithRedirect:failingURL];
        return;
    }
    if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) {
        return;
    }
    // WebKitErrorFrameLoadInterruptedByPolicyChange: caused by our own policy decisions.
    if ([error.domain isEqualToString:@"WebKitErrorDomain"] && error.code == 102) {
        return;
    }
    [self hideLoader];
    [[RNAppAuthMessageHub sharedHub] emit:@"navigationFailed"
                                     mode:RNAppAuthModeWebView
                                   extras:@{@"url": failingURL.absoluteString ?: @"",
                                            @"error": error.localizedDescription ?: @""}];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self handleNavigationError:error];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self handleNavigationError:error];
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)navigationAction
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
    // target="_blank" / window.open: keep the flow inside this web view.
    if (navigationAction.targetFrame == nil) {
        [webView loadRequest:navigationAction.request];
    }
    return nil;
}

@end

@implementation RNAppAuthWebViewUserAgent {
    __weak UIViewController *_presentingViewController;
    NSURL *_redirectURL;
    RNAppAuthBrowserOptions *_options;
    __weak id<OIDExternalUserAgentSession> _session;
    UINavigationController *_navigationController;
    RNAppAuthWebViewController *_webViewController;
    BOOL _inProgress;
}

+ (void)clearWebViewDataWithCompletion:(void (^)(void))completion {
    [[WKWebsiteDataStore defaultDataStore] removeDataOfTypes:[WKWebsiteDataStore allWebsiteDataTypes]
                                               modifiedSince:[NSDate distantPast]
                                           completionHandler:^{
                                               if (completion) completion();
                                           }];
}

- (instancetype)initWithPresentingViewController:(UIViewController *)presentingViewController
                                     redirectURL:(NSURL *)redirectURL
                                         options:(RNAppAuthBrowserOptions *)options {
    if ((self = [super init])) {
        _presentingViewController = presentingViewController;
        _redirectURL = redirectURL;
        _options = options;
    }
    return self;
}

- (NSString *)mode {
    return RNAppAuthModeWebView;
}

- (BOOL)presentExternalUserAgentRequest:(id<OIDExternalUserAgentRequest>)request
                                session:(id<OIDExternalUserAgentSession>)session {
    if (_inProgress || _presentingViewController == nil) {
        return NO;
    }
    _inProgress = YES;
    _session = session;

    NSURL *url = [request externalUserAgentRequestURL];
    RNAppAuthWebViewController *controller = [[RNAppAuthWebViewController alloc] initWithURL:url
                                                                                 redirectURL:_redirectURL
                                                                              redirectScheme:[request redirectScheme]
                                                                                     options:_options];
    __weak typeof(self) weakSelf = self;
    controller.onRedirect = ^(NSURL *redirect) {
        typeof(self) strongSelf = weakSelf;
        // The session dismisses this user agent when it accepts the redirect.
        RNAppAuthResumeSession(strongSelf->_session, redirect);
    };
    controller.onCancel = ^{
        typeof(self) strongSelf = weakSelf;
        if (strongSelf == nil || !strongSelf->_inProgress) {
            return;
        }
        id<OIDExternalUserAgentSession> flow = strongSelf->_session;
        strongSelf->_session = nil;
        [strongSelf dismissAnimated:YES completion:^{
            [flow failExternalUserAgentFlowWithError:RNAppAuthUserCancelledError(nil)];
        }];
    };
    _webViewController = controller;

    UINavigationController *navigation = [[UINavigationController alloc] initWithRootViewController:controller];
    if (_options.presentationStyle != UIModalPresentationAutomatic) {
        navigation.modalPresentationStyle = _options.presentationStyle;
    }
    navigation.modalInPresentation = _options.modalInPresentation;
    navigation.presentationController.delegate = controller;
    _navigationController = navigation;

    [[RNAppAuthMessageHub sharedHub] attachTarget:controller mode:self.mode];

    void (^present)(void) = ^{
        typeof(self) strongSelf = weakSelf;
        UIViewController *presenting = strongSelf->_presentingViewController;
        if (strongSelf == nil || !strongSelf->_inProgress || presenting == nil) {
            return;
        }
        NSString *mode = strongSelf.mode;
        [presenting presentViewController:navigation animated:YES completion:^{
            [[RNAppAuthMessageHub sharedHub] emit:@"opened" mode:mode extras:@{@"url": url.absoluteString ?: @""}];
        }];
    };
    if (_options.clearWebViewData) {
        [[self class] clearWebViewDataWithCompletion:present];
    } else {
        present();
    }
    return YES;
}

- (void)dismissExternalUserAgentAnimated:(BOOL)animated completion:(void (^)(void))completion {
    _session = nil;
    [self dismissAnimated:animated completion:completion];
}

- (void)dismissAnimated:(BOOL)animated completion:(void (^)(void))completion {
    if (!_inProgress) {
        if (completion) completion();
        return;
    }
    _inProgress = NO;
    UINavigationController *navigation = _navigationController;
    RNAppAuthWebViewController *controller = _webViewController;
    _navigationController = nil;
    _webViewController = nil;
    [[RNAppAuthMessageHub sharedHub] detachTarget:controller];
    NSString *mode = self.mode;
    void (^finish)(void) = ^{
        [[RNAppAuthMessageHub sharedHub] emit:@"closed" mode:mode extras:nil];
        if (completion) completion();
    };
    if (navigation.presentingViewController != nil) {
        [navigation dismissViewControllerAnimated:animated completion:finish];
    } else {
        finish();
    }
}

@end
