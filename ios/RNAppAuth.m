#import "RNAppAuth.h"
#if __has_include(<AppAuth/AppAuth.h>)
#import <AppAuth/AppAuth.h>
#else
#import "AppAuth.h"
#endif
#import <React/RCTLog.h>
#import <React/RCTConvert.h>
#import "RNAppAuthAuthorizationFlowManager.h"
#import "RNAppAuthPresentation.h"
#import "RNAppAuthBrowserOptions.h"
#import "RNAppAuthMessageHub.h"
#import "RNAppAuthUserAgents.h"

static NSString *const RNAppAuthBrowserEventName = @"RNAppAuthBrowserEvent";

/*! @brief Number of random bytes generated for the @ state. */
static NSUInteger const kStateSizeBytes = 32;
/*! @brief Number of random bytes generated for the @ codeVerifier. */
static NSUInteger const kCodeVerifierBytes = 32;

// UIBackgroundTaskInvalid (0) is not a compile-time constant in Objective-C.
static UIBackgroundTaskIdentifier rnAppAuthTaskId = 0;

static void RNAppAuthBeginBackgroundTask(void) {
    if (rnAppAuthTaskId != UIBackgroundTaskInvalid) {
        [UIApplication.sharedApplication endBackgroundTask:rnAppAuthTaskId];
    }
    rnAppAuthTaskId = [UIApplication.sharedApplication beginBackgroundTaskWithExpirationHandler:^{
        [UIApplication.sharedApplication endBackgroundTask:rnAppAuthTaskId];
        rnAppAuthTaskId = UIBackgroundTaskInvalid;
    }];
}

static void RNAppAuthEndBackgroundTask(void) {
    if (rnAppAuthTaskId != UIBackgroundTaskInvalid) {
        [UIApplication.sharedApplication endBackgroundTask:rnAppAuthTaskId];
        rnAppAuthTaskId = UIBackgroundTaskInvalid;
    }
}

static NSDictionary *RNAppAuthNonNullDictionary(NSDictionary *dictionary) {
    return [dictionary isKindOfClass:[NSDictionary class]] ? dictionary : @{};
}

@interface RNAppAuth () <RNAppAuthAuthorizationFlowManagerDelegate> {
    id<OIDExternalUserAgentSession> _currentSession;
    BOOL _dismissRequested;
    BOOL _hasListeners;
}
@end

@implementation RNAppAuth

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (dispatch_queue_t)methodQueue {
    return dispatch_get_main_queue();
}

- (instancetype)init {
    if ((self = [super init])) {
        __weak typeof(self) weakSelf = self;
        [RNAppAuthMessageHub sharedHub].eventHandler = ^(NSDictionary *event) {
            typeof(self) strongSelf = weakSelf;
            if (strongSelf != nil && strongSelf->_hasListeners) {
                [strongSelf sendEventWithName:RNAppAuthBrowserEventName body:event];
            }
        };
    }
    return self;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[RNAppAuthBrowserEventName];
}

- (void)startObserving {
    _hasListeners = YES;
}

- (void)stopObserving {
    _hasListeners = NO;
}

- (BOOL)resumeExternalUserAgentFlowWithURL:(NSURL *)url {
    id<OIDExternalUserAgentSession> session = _currentSession;
    if (session == nil) {
        return NO;
    }
    BOOL handled = RNAppAuthResumeSession(session, url);
    // A session consumes at most one redirect. Once it has accepted one, stop forwarding URLs to
    // it: the code exchange that may still be running does not need the session, and AppAuth
    // < 2.1.0 raises an NSException when a completed session is resumed again.
    if (handled && _currentSession == session) {
        _currentSession = nil;
    }
    return handled;
}

#pragma mark - Exported methods

RCT_REMAP_METHOD(register,
                 issuer: (NSString *) issuer
                 redirectUrls: (NSArray *) redirectUrls
                 responseTypes: (NSArray *) responseTypes
                 grantTypes: (NSArray *) grantTypes
                 subjectType: (NSString *) subjectType
                 tokenEndpointAuthMethod: (NSString *) tokenEndpointAuthMethod
                 additionalParameters: (NSDictionary *_Nullable) additionalParameters
                 serviceConfiguration: (NSDictionary *_Nullable) serviceConfiguration
                 connectionTimeoutSeconds: (double) connectionTimeoutSeconds
                 additionalHeaders: (NSDictionary *_Nullable) additionalHeaders
                 resolve: (RCTPromiseResolveBlock) resolve
                 reject: (RCTPromiseRejectBlock) reject)
{
    [self configureUrlSession:additionalHeaders sessionTimeout:connectionTimeoutSeconds];
    [self withConfiguration:serviceConfiguration issuer:issuer reject:reject run:^(OIDServiceConfiguration *configuration) {
        NSMutableArray<NSURL *> *urls = [NSMutableArray arrayWithCapacity:redirectUrls.count];
        for (NSString *urlString in redirectUrls) {
            [urls addObject:[NSURL URLWithString:urlString]];
        }
        OIDRegistrationRequest *request =
            [[OIDRegistrationRequest alloc] initWithConfiguration:configuration
                                                     redirectURIs:urls
                                                    responseTypes:responseTypes
                                                       grantTypes:grantTypes
                                                      subjectType:subjectType
                                          tokenEndpointAuthMethod:tokenEndpointAuthMethod
                                             additionalParameters:additionalParameters];
        [OIDAuthorizationService performRegistrationRequest:request
                                                 completion:^(OIDRegistrationResponse *response, NSError *error) {
            if (response) {
                resolve([self formatRegistrationResponse:response]);
            } else {
                [self rejectPromise:reject defaultCode:@"registration_failed" error:error];
            }
        }];
    }];
}

RCT_REMAP_METHOD(authorize,
                 issuer: (NSString *) issuer
                 redirectUrl: (NSString *) redirectUrl
                 clientId: (NSString *) clientId
                 clientSecret: (NSString *) clientSecret
                 scopes: (NSArray *) scopes
                 additionalParameters: (NSDictionary *_Nullable) additionalParameters
                 serviceConfiguration: (NSDictionary *_Nullable) serviceConfiguration
                 skipCodeExchange: (BOOL) skipCodeExchange
                 connectionTimeoutSeconds: (double) connectionTimeoutSeconds
                 additionalHeaders: (NSDictionary *_Nullable) additionalHeaders
                 useNonce: (BOOL) useNonce
                 usePKCE: (BOOL) usePKCE
                 iosCustomBrowser: (NSString *) iosCustomBrowser
                 prefersEphemeralSession: (BOOL) prefersEphemeralSession
                 clientAuthMethod: (NSString *) clientAuthMethod
                 browserOptions: (NSDictionary *_Nullable) browserOptions
                 resolve: (RCTPromiseResolveBlock) resolve
                 reject: (RCTPromiseRejectBlock) reject)
{
    [self configureUrlSession:additionalHeaders sessionTimeout:connectionTimeoutSeconds];
    RNAppAuthBrowserOptions *options = [RNAppAuthBrowserOptions optionsWithDictionary:browserOptions];
    [self withConfiguration:serviceConfiguration issuer:issuer reject:reject run:^(OIDServiceConfiguration *configuration) {
        [self authorizeWithConfiguration:configuration
                             redirectUrl:redirectUrl
                                clientId:clientId
                            clientSecret:clientSecret
                                  scopes:scopes
                                useNonce:useNonce
                                 usePKCE:usePKCE
                    additionalParameters:additionalParameters
                        skipCodeExchange:skipCodeExchange
                        iosCustomBrowser:iosCustomBrowser
                 prefersEphemeralSession:prefersEphemeralSession
                        clientAuthMethod:clientAuthMethod
                          browserOptions:options
                                 resolve:resolve
                                  reject:reject];
    }];
}

RCT_REMAP_METHOD(refresh,
                 issuer: (NSString *) issuer
                 redirectUrl: (NSString *) redirectUrl
                 clientId: (NSString *) clientId
                 clientSecret: (NSString *) clientSecret
                 refreshToken: (NSString *) refreshToken
                 scopes: (NSArray *) scopes
                 additionalParameters: (NSDictionary *_Nullable) additionalParameters
                 serviceConfiguration: (NSDictionary *_Nullable) serviceConfiguration
                 connectionTimeoutSeconds: (double) connectionTimeoutSeconds
                 additionalHeaders: (NSDictionary *_Nullable) additionalHeaders
                 iosCustomBrowser: (NSString *) iosCustomBrowser
                 clientAuthMethod: (NSString *) clientAuthMethod
                 resolve: (RCTPromiseResolveBlock) resolve
                 reject: (RCTPromiseRejectBlock) reject)
{
    [self configureUrlSession:additionalHeaders sessionTimeout:connectionTimeoutSeconds];
    [self withConfiguration:serviceConfiguration issuer:issuer reject:reject run:^(OIDServiceConfiguration *configuration) {
        BOOL post = [self usesClientSecretPost:clientAuthMethod clientSecret:clientSecret];
        NSMutableDictionary *parameters = [RNAppAuthNonNullDictionary(additionalParameters) mutableCopy];
        if (post) {
            parameters[@"client_secret"] = clientSecret;
        }
        OIDTokenRequest *request =
            [[OIDTokenRequest alloc] initWithConfiguration:configuration
                                                 grantType:OIDGrantTypeRefreshToken
                                         authorizationCode:nil
                                               redirectURL:[NSURL URLWithString:redirectUrl]
                                                  clientID:clientId
                                              clientSecret:post ? nil : clientSecret
                                                    scopes:scopes
                                              refreshToken:refreshToken
                                              codeVerifier:nil
                                      additionalParameters:parameters];
        [OIDAuthorizationService performTokenRequest:request
                                            callback:^(OIDTokenResponse *response, NSError *error) {
            if (response) {
                resolve([self formatResponse:response]);
            } else {
                [self rejectPromise:reject defaultCode:@"token_refresh_failed" error:error];
            }
        }];
    }];
}

RCT_REMAP_METHOD(logout,
                 issuer: (NSString *) issuer
                 idTokenHint: (NSString *) idTokenHint
                 postLogoutRedirectURL: (NSString *) postLogoutRedirectURL
                 serviceConfiguration: (NSDictionary *_Nullable) serviceConfiguration
                 additionalParameters: (NSDictionary *_Nullable) additionalParameters
                 iosCustomBrowser: (NSString *) iosCustomBrowser
                 prefersEphemeralSession: (BOOL) prefersEphemeralSession
                 browserOptions: (NSDictionary *_Nullable) browserOptions
                 resolve: (RCTPromiseResolveBlock) resolve
                 reject: (RCTPromiseRejectBlock) reject)
{
    RNAppAuthBrowserOptions *options = [RNAppAuthBrowserOptions optionsWithDictionary:browserOptions];
    [self withConfiguration:serviceConfiguration issuer:issuer reject:reject run:^(OIDServiceConfiguration *configuration) {
        [self endSessionWithConfiguration:configuration
                              idTokenHint:idTokenHint
                    postLogoutRedirectURL:postLogoutRedirectURL
                     additionalParameters:additionalParameters
                         iosCustomBrowser:iosCustomBrowser
                  prefersEphemeralSession:prefersEphemeralSession
                           browserOptions:options
                                  resolve:resolve
                                   reject:reject];
    }];
}

RCT_EXPORT_METHOD(postBrowserMessage:(NSString *)message
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    resolve([[RNAppAuthMessageHub sharedHub] postMessage:message ?: @""]);
}

RCT_EXPORT_METHOD(clearPendingBrowserMessages:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [[RNAppAuthMessageHub sharedHub] clearPendingMessages];
    resolve(nil);
}

RCT_EXPORT_METHOD(dismissBrowser:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    id<OIDExternalUserAgentSession> session = _currentSession;
    if (session == nil) {
        resolve(@NO);
        return;
    }
    _dismissRequested = YES;
    _currentSession = nil;
    [session cancel];
    resolve(@YES);
}

RCT_EXPORT_METHOD(clearWebViewData:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [RNAppAuthWebViewUserAgent clearWebViewDataWithCompletion:^{
        resolve(nil);
    }];
}

#pragma mark - Configuration

- (void)withConfiguration:(NSDictionary *)serviceConfiguration
                   issuer:(NSString *)issuer
                   reject:(RCTPromiseRejectBlock)reject
                      run:(void (^)(OIDServiceConfiguration *configuration))run {
    // A manually provided (or JS-cached) configuration skips the OIDC discovery request.
    if ([serviceConfiguration isKindOfClass:[NSDictionary class]]) {
        run([self createServiceConfiguration:serviceConfiguration]);
        return;
    }
    [OIDAuthorizationService discoverServiceConfigurationForIssuer:[NSURL URLWithString:issuer]
                                                        completion:^(OIDServiceConfiguration *configuration, NSError *error) {
        if (!configuration) {
            [self rejectPromise:reject defaultCode:@"service_configuration_fetch_error" error:error];
            return;
        }
        run(configuration);
    }];
}

- (OIDServiceConfiguration *)createServiceConfiguration:(NSDictionary *)serviceConfiguration {
    NSDictionary *document = serviceConfiguration[@"discoveryDocument"];
    if ([document isKindOfClass:[NSDictionary class]]) {
        NSError *error = nil;
        OIDServiceDiscovery *discovery = [[OIDServiceDiscovery alloc] initWithDictionary:document error:&error];
        if (discovery != nil) {
            return [[OIDServiceConfiguration alloc] initWithDiscoveryDocument:discovery];
        }
    }
    NSURL *(^url)(NSString *) = ^NSURL *(NSString *key) {
        id value = serviceConfiguration[key];
        return [value isKindOfClass:[NSString class]] ? [NSURL URLWithString:value] : nil;
    };
    return [[OIDServiceConfiguration alloc] initWithAuthorizationEndpoint:url(@"authorizationEndpoint")
                                                            tokenEndpoint:url(@"tokenEndpoint")
                                                                   issuer:url(@"issuer")
                                                     registrationEndpoint:url(@"registrationEndpoint")
                                                       endSessionEndpoint:url(@"endSessionEndpoint")];
}

- (void)configureUrlSession:(NSDictionary *)headers sessionTimeout:(double)sessionTimeout {
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration defaultSessionConfiguration];
    if ([headers isKindOfClass:[NSDictionary class]]) {
        configuration.HTTPAdditionalHeaders = headers;
    }
    if (sessionTimeout > 0) {
        configuration.timeoutIntervalForRequest = sessionTimeout;
    }
    [OIDURLSessionProvider setSession:[NSURLSession sessionWithConfiguration:configuration]];
}

+ (nullable NSString *)generateCodeVerifier {
    return [OIDTokenUtilities randomURLSafeStringWithSize:kCodeVerifierBytes];
}

+ (nullable NSString *)generateState {
    return [OIDTokenUtilities randomURLSafeStringWithSize:kStateSizeBytes];
}

+ (nullable NSString *)codeChallengeS256ForVerifier:(NSString *)codeVerifier {
    if (!codeVerifier) {
        return nil;
    }
    // code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier))), RFC 7636 section 4.2
    return [OIDTokenUtilities encodeBase64urlNoPadding:[OIDTokenUtilities sha256:codeVerifier]];
}

- (BOOL)usesClientSecretPost:(NSString *)clientAuthMethod clientSecret:(NSString *)clientSecret {
    return [clientAuthMethod isEqualToString:@"post"] && clientSecret.length > 0;
}

#pragma mark - Flows

- (nullable UIViewController *)prepareInteractiveFlow {
    id<UIApplicationDelegate, RNAppAuthAuthorizationFlowManager> appDelegate =
        (id<UIApplicationDelegate, RNAppAuthAuthorizationFlowManager>)UIApplication.sharedApplication.delegate;
    if (![[appDelegate class] conformsToProtocol:@protocol(RNAppAuthAuthorizationFlowManager)]) {
        [NSException raise:@"RNAppAuth Missing protocol conformance"
                    format:@"%@ does not conform to RNAppAuthAuthorizationFlowManager", appDelegate];
    }
    UIViewController *presentingViewController = RNAppAuthPresentingViewController(UIApplication.sharedApplication);
    if (presentingViewController == nil) {
        return nil;
    }
    appDelegate.authorizationFlowManagerDelegate = self;
    _dismissRequested = NO;
    return presentingViewController;
}

- (id<OIDExternalUserAgent>)userAgentWithOptions:(RNAppAuthBrowserOptions *)options
                                   customBrowser:(NSString *)customBrowser
                                       ephemeral:(BOOL)ephemeral
                                      presenting:(UIViewController *)presentingViewController
                                     redirectURL:(NSURL *)redirectURL {
#if TARGET_OS_MACCATALYST
    return [[OIDExternalUserAgentCatalyst alloc] initWithPresentingViewController:presentingViewController];
#else
    if ([customBrowser isKindOfClass:[NSString class]]) {
        id<OIDExternalUserAgent> browser = [self getCustomBrowser:customBrowser];
        if (browser != nil) {
            return browser;
        }
    }
    if ([options.mode isEqualToString:RNAppAuthModeWebView]) {
        return [[RNAppAuthWebViewUserAgent alloc] initWithPresentingViewController:presentingViewController
                                                                       redirectURL:redirectURL
                                                                           options:options];
    }
    if ([options.mode isEqualToString:RNAppAuthModeSafariViewController]) {
        return [[RNAppAuthSafariUserAgent alloc] initWithPresentingViewController:presentingViewController
                                                                          options:options];
    }
    return [[RNAppAuthWebAuthenticationSessionUserAgent alloc] initWithPresentingViewController:presentingViewController
                                                                                    redirectURL:redirectURL
                                                                                      ephemeral:ephemeral
                                                                                        options:options];
#endif
}

- (void)authorizeWithConfiguration:(OIDServiceConfiguration *)configuration
                       redirectUrl:(NSString *)redirectUrl
                          clientId:(NSString *)clientId
                      clientSecret:(NSString *)clientSecret
                            scopes:(NSArray *)scopes
                          useNonce:(BOOL)useNonce
                           usePKCE:(BOOL)usePKCE
              additionalParameters:(NSDictionary *_Nullable)additionalParameters
                  skipCodeExchange:(BOOL)skipCodeExchange
                  iosCustomBrowser:(NSString *)iosCustomBrowser
           prefersEphemeralSession:(BOOL)prefersEphemeralSession
                  clientAuthMethod:(NSString *)clientAuthMethod
                    browserOptions:(RNAppAuthBrowserOptions *)options
                           resolve:(RCTPromiseResolveBlock)resolve
                            reject:(RCTPromiseRejectBlock)reject
{
    NSDictionary *parameters = RNAppAuthNonNullDictionary(additionalParameters);
    NSString *codeVerifier = usePKCE ? [[self class] generateCodeVerifier] : nil;
    NSString *codeChallenge = usePKCE ? [[self class] codeChallengeS256ForVerifier:codeVerifier] : nil;
    NSString *nonce = useNonce ? (parameters[@"nonce"] ?: [[self class] generateState]) : nil;

    NSMutableDictionary *requestParameters = [parameters mutableCopy];
    [requestParameters removeObjectForKey:@"state"];
    [requestParameters removeObjectForKey:@"nonce"];

    NSURL *redirectURL = [NSURL URLWithString:redirectUrl];
    OIDAuthorizationRequest *request =
        [[OIDAuthorizationRequest alloc] initWithConfiguration:configuration
                                                      clientId:clientId
                                                  clientSecret:clientSecret
                                                         scope:[OIDScopeUtilities scopesWithArray:scopes]
                                                   redirectURL:redirectURL
                                                  responseType:OIDResponseTypeCode
                                                         state:parameters[@"state"] ?: [[self class] generateState]
                                                         nonce:nonce
                                                  codeVerifier:codeVerifier
                                                 codeChallenge:codeChallenge
                                           codeChallengeMethod:usePKCE ? OIDOAuthorizationRequestCodeChallengeMethodS256 : nil
                                          additionalParameters:[requestParameters copy]];

    UIViewController *presentingViewController = [self prepareInteractiveFlow];
    if (presentingViewController == nil) {
        reject(@"authentication_failed", @"No foreground window is available to present authorization.", nil);
        return;
    }
    id<OIDExternalUserAgent> userAgent = [self userAgentWithOptions:options
                                                      customBrowser:iosCustomBrowser
                                                          ephemeral:prefersEphemeralSession
                                                         presenting:presentingViewController
                                                        redirectURL:redirectURL];

    __weak typeof(self) weakSelf = self;
    // Set when the flow's callback has run. The callback can run synchronously, before the
    // presenting call below returns (e.g. when the user-agent fails to open).
    __block BOOL flowCompleted = NO;
    RNAppAuthBeginBackgroundTask();

    BOOL post = [self usesClientSecretPost:clientAuthMethod clientSecret:clientSecret];
    id<OIDExternalUserAgentSession> session =
        [OIDAuthorizationService presentAuthorizationRequest:request
                                           externalUserAgent:userAgent
                                                    callback:^(OIDAuthorizationResponse *authorizationResponse, NSError *error) {
        typeof(self) strongSelf = weakSelf;
        flowCompleted = YES;
        if (strongSelf == nil) {
            RNAppAuthEndBackgroundTask();
            return;
        }
        strongSelf->_currentSession = nil;
        if (authorizationResponse == nil) {
            RNAppAuthEndBackgroundTask();
            [strongSelf rejectPromise:reject defaultCode:@"authentication_failed" error:error];
            return;
        }
        if (skipCodeExchange) {
            RNAppAuthEndBackgroundTask();
            resolve([strongSelf formatAuthorizationResponse:authorizationResponse withCodeVerifier:codeVerifier]);
            return;
        }
        [strongSelf exchangeAuthorizationResponse:authorizationResponse
                                          request:request
                                   clientSecretPost:post
                                          resolve:resolve
                                           reject:reject];
    }];

    // If the callback already ran, the session returned above has completed: do not keep it,
    // otherwise a later redirect would be forwarded to a finished session.
    _currentSession = flowCompleted ? nil : session;
}

- (void)exchangeAuthorizationResponse:(OIDAuthorizationResponse *)authorizationResponse
                              request:(OIDAuthorizationRequest *)request
                     clientSecretPost:(BOOL)clientSecretPost
                              resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject {
    OIDTokenRequest *tokenRequest;
    if (clientSecretPost) {
        // client_secret_post: send the secret in the body instead of the Authorization header.
        tokenRequest = [[OIDTokenRequest alloc] initWithConfiguration:request.configuration
                                                            grantType:OIDGrantTypeAuthorizationCode
                                                    authorizationCode:authorizationResponse.authorizationCode
                                                          redirectURL:request.redirectURL
                                                             clientID:request.clientID
                                                         clientSecret:nil
                                                               scopes:nil
                                                         refreshToken:nil
                                                         codeVerifier:request.codeVerifier
                                                 additionalParameters:@{@"client_secret": request.clientSecret}];
    } else {
        tokenRequest = [authorizationResponse tokenExchangeRequest];
    }
    [OIDAuthorizationService performTokenRequest:tokenRequest
                   originalAuthorizationResponse:authorizationResponse
                                        callback:^(OIDTokenResponse *tokenResponse, NSError *error) {
        RNAppAuthEndBackgroundTask();
        if (tokenResponse) {
            resolve([self formatResponse:tokenResponse withAuthResponse:authorizationResponse]);
        } else {
            [self rejectPromise:reject defaultCode:@"token_exchange_failed" error:error];
        }
    }];
}

- (void)endSessionWithConfiguration:(OIDServiceConfiguration *)configuration
                        idTokenHint:(NSString *)idTokenHint
              postLogoutRedirectURL:(NSString *)postLogoutRedirectURL
               additionalParameters:(NSDictionary *_Nullable)additionalParameters
                   iosCustomBrowser:(NSString *)iosCustomBrowser
            prefersEphemeralSession:(BOOL)prefersEphemeralSession
                     browserOptions:(RNAppAuthBrowserOptions *)options
                            resolve:(RCTPromiseResolveBlock)resolve
                             reject:(RCTPromiseRejectBlock)reject {
    NSURL *redirectURL = [NSURL URLWithString:postLogoutRedirectURL];
    OIDEndSessionRequest *endSessionRequest =
        [[OIDEndSessionRequest alloc] initWithConfiguration:configuration
                                                idTokenHint:idTokenHint
                                      postLogoutRedirectURL:redirectURL
                                       additionalParameters:additionalParameters];

    UIViewController *presentingViewController = [self prepareInteractiveFlow];
    if (presentingViewController == nil) {
        reject(@"end_session_failed", @"No foreground window is available to present logout.", nil);
        return;
    }
    id<OIDExternalUserAgent> userAgent = [self userAgentWithOptions:options
                                                      customBrowser:iosCustomBrowser
                                                          ephemeral:prefersEphemeralSession
                                                         presenting:presentingViewController
                                                        redirectURL:redirectURL];

    __weak typeof(self) weakSelf = self;
    __block BOOL flowCompleted = NO;
    RNAppAuthBeginBackgroundTask();

    id<OIDExternalUserAgentSession> session =
        [OIDAuthorizationService presentEndSessionRequest:endSessionRequest
                                        externalUserAgent:userAgent
                                                 callback:^(OIDEndSessionResponse *response, NSError *error) {
        typeof(self) strongSelf = weakSelf;
        flowCompleted = YES;
        RNAppAuthEndBackgroundTask();
        if (strongSelf == nil) {
            return;
        }
        strongSelf->_currentSession = nil;
        if (response) {
            resolve([strongSelf formatEndSessionResponse:response]);
        } else {
            [strongSelf rejectPromise:reject defaultCode:@"end_session_failed" error:error];
        }
    }];

    _currentSession = flowCompleted ? nil : session;
}

#pragma mark - Formatting

- (NSDateFormatter *)dateFormatter {
    NSDateFormatter *dateFormat = [[NSDateFormatter alloc] init];
    dateFormat.timeZone = [NSTimeZone timeZoneWithAbbreviation:@"UTC"];
    dateFormat.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    dateFormat.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss'Z'";
    return dateFormat;
}

- (NSDictionary *)formatAuthorizationResponse:(OIDAuthorizationResponse *)response withCodeVerifier:(NSString *)codeVerifier {
    NSDateFormatter *dateFormat = [self dateFormatter];
    NSMutableDictionary *result = [@{
        @"authorizationCode": response.authorizationCode ?: @"",
        @"state": response.state ?: @"",
        @"accessToken": response.accessToken ?: @"",
        @"accessTokenExpirationDate": response.accessTokenExpirationDate ? [dateFormat stringFromDate:response.accessTokenExpirationDate] : @"",
        @"tokenType": response.tokenType ?: @"",
        @"idToken": response.idToken ?: @"",
        @"scopes": response.scope ? [response.scope componentsSeparatedByString:@" "] : @[],
        @"additionalParameters": response.additionalParameters ?: @{},
    } mutableCopy];
    if (codeVerifier != nil) {
        result[@"codeVerifier"] = codeVerifier;
    }
    return result;
}

- (NSDictionary *)formatResponse:(OIDTokenResponse *)response {
    NSDateFormatter *dateFormat = [self dateFormatter];
    return @{
        @"accessToken": response.accessToken ?: @"",
        @"accessTokenExpirationDate": response.accessTokenExpirationDate ? [dateFormat stringFromDate:response.accessTokenExpirationDate] : @"",
        @"additionalParameters": response.additionalParameters ?: @{},
        @"idToken": response.idToken ?: @"",
        @"refreshToken": response.refreshToken ?: @"",
        @"tokenType": response.tokenType ?: @"",
        @"scopes": response.scope ? [response.scope componentsSeparatedByString:@" "] : @[],
    };
}

- (NSDictionary *)formatResponse:(OIDTokenResponse *)response withAuthResponse:(OIDAuthorizationResponse *)authResponse {
    NSDateFormatter *dateFormat = [self dateFormatter];
    NSString *scope = response.scope ?: authResponse.scope;
    return @{
        @"accessToken": response.accessToken ?: @"",
        @"accessTokenExpirationDate": response.accessTokenExpirationDate ? [dateFormat stringFromDate:response.accessTokenExpirationDate] : @"",
        @"authorizeAdditionalParameters": authResponse.additionalParameters ?: @{},
        @"tokenAdditionalParameters": response.additionalParameters ?: @{},
        @"idToken": response.idToken ?: @"",
        @"refreshToken": response.refreshToken ?: @"",
        @"tokenType": response.tokenType ?: @"",
        @"scopes": scope ? [scope componentsSeparatedByString:@" "] : @[],
    };
}

- (NSDictionary *)formatRegistrationResponse:(OIDRegistrationResponse *)response {
    NSDateFormatter *dateFormat = [self dateFormatter];
    return @{
        @"clientId": response.clientID ?: @"",
        @"additionalParameters": response.additionalParameters ?: @{},
        @"clientIdIssuedAt": response.clientIDIssuedAt ? [dateFormat stringFromDate:response.clientIDIssuedAt] : @"",
        @"clientSecret": response.clientSecret ?: @"",
        @"clientSecretExpiresAt": response.clientSecretExpiresAt ? [dateFormat stringFromDate:response.clientSecretExpiresAt] : @"",
        @"registrationAccessToken": response.registrationAccessToken ?: @"",
        @"registrationClientUri": response.registrationClientURI.absoluteString ?: @"",
        @"tokenEndpointAuthMethod": response.tokenEndpointAuthenticationMethod ?: @"",
    };
}

- (NSDictionary *)formatEndSessionResponse:(OIDEndSessionResponse *)response {
    return @{
        @"state": response.state ?: @"",
        @"idTokenHint": response.request.idTokenHint ?: @"",
        @"postLogoutRedirectUri": response.request.postLogoutRedirectURL.absoluteString ?: @"",
    };
}

#pragma mark - Errors

- (NSString *)getErrorCode:(NSError *)error defaultCode:(NSString *)defaultCode {
    if ([error.domain isEqualToString:OIDOAuthAuthorizationErrorDomain]) {
        switch (error.code) {
            case OIDErrorCodeOAuthAuthorizationInvalidRequest: return @"invalid_request";
            case OIDErrorCodeOAuthAuthorizationUnauthorizedClient: return @"unauthorized_client";
            case OIDErrorCodeOAuthAuthorizationAccessDenied: return @"access_denied";
            case OIDErrorCodeOAuthAuthorizationUnsupportedResponseType: return @"unsupported_response_type";
            case OIDErrorCodeOAuthAuthorizationAuthorizationInvalidScope: return @"invalid_scope";
            case OIDErrorCodeOAuthAuthorizationServerError: return @"server_error";
            case OIDErrorCodeOAuthAuthorizationTemporarilyUnavailable: return @"temporarily_unavailable";
        }
    } else if ([error.domain isEqualToString:OIDOAuthTokenErrorDomain]) {
        switch (error.code) {
            case OIDErrorCodeOAuthTokenInvalidRequest: return @"invalid_request";
            case OIDErrorCodeOAuthTokenInvalidClient: return @"invalid_client";
            case OIDErrorCodeOAuthTokenInvalidGrant: return @"invalid_grant";
            case OIDErrorCodeOAuthTokenUnauthorizedClient: return @"unauthorized_client";
            case OIDErrorCodeOAuthTokenUnsupportedGrantType: return @"unsupported_grant_type";
            case OIDErrorCodeOAuthTokenInvalidScope: return @"invalid_scope";
        }
    } else if ([error.domain isEqualToString:OIDOAuthRegistrationErrorDomain]) {
        switch (error.code) {
            case OIDErrorCodeOAuthRegistrationInvalidRequest: return @"invalid_request";
            case OIDErrorCodeOAuthRegistrationInvalidRedirectURI: return @"invalid_redirect_uri";
            case OIDErrorCodeOAuthRegistrationInvalidClientMetadata: return @"invalid_client_metadata";
        }
    }
    return defaultCode;
}

- (NSString *)getErrorReason:(NSError *)error {
    NSString *domain = error.domain;
    if ([domain isEqualToString:OIDGeneralErrorDomain]) {
        switch (error.code) {
            case OIDErrorCodeUserCanceledAuthorizationFlow:
                return _dismissRequested ? @"program_cancelled" : @"user_cancelled";
            case OIDErrorCodeProgramCanceledAuthorizationFlow:
                return @"program_cancelled";
            case OIDErrorCodeNetworkError:
                return @"network_error";
            case OIDErrorCodeServerError:
                return @"server_error";
            case OIDErrorCodeIDTokenParsingError:
            case OIDErrorCodeIDTokenFailedValidationError:
                return @"id_token_validation";
            case OIDErrorCodeBrowserOpenError:
            case OIDErrorCodeSafariOpenError:
                return @"browser_not_found";
            default:
                return @"invalid_response";
        }
    }
    if ([domain isEqualToString:OIDOAuthAuthorizationErrorDomain] || [domain isEqualToString:OIDOAuthTokenErrorDomain] ||
        [domain isEqualToString:OIDOAuthRegistrationErrorDomain] || [domain isEqualToString:OIDResourceServerAuthorizationErrorDomain]) {
        return @"oauth_error";
    }
    if ([domain isEqualToString:NSURLErrorDomain]) {
        return @"network_error";
    }
    if ([domain isEqualToString:OIDHTTPErrorDomain]) {
        return @"server_error";
    }
    return @"unknown";
}

- (nullable NSNumber *)getHttpStatus:(NSError *)error {
    NSError *current = error;
    for (int depth = 0; current != nil && depth < 5; depth++) {
        if ([current.domain isEqualToString:OIDHTTPErrorDomain] && current.code >= 100 && current.code < 600) {
            return @(current.code);
        }
        current = current.userInfo[NSUnderlyingErrorKey];
    }
    return nil;
}

- (NSString *)getErrorMessage:(NSError *)error {
    NSDictionary *response = error.userInfo[OIDOAuthErrorResponseErrorKey];
    if ([response isKindOfClass:[NSDictionary class]] && response[OIDOAuthErrorFieldErrorDescription]) {
        return response[OIDOAuthErrorFieldErrorDescription];
    }
    return error.localizedDescription;
}


#if !TARGET_OS_MACCATALYST
- (id<OIDExternalUserAgent>)getCustomBrowser:(NSString *)browserType {
    if ([browserType isEqualToString:@"safari"]) return [OIDExternalUserAgentIOSCustomBrowser CustomBrowserSafari];
    if ([browserType isEqualToString:@"chrome"]) return [OIDExternalUserAgentIOSCustomBrowser CustomBrowserChrome];
    if ([browserType isEqualToString:@"opera"]) return [OIDExternalUserAgentIOSCustomBrowser CustomBrowserOpera];
    if ([browserType isEqualToString:@"firefox"]) return [OIDExternalUserAgentIOSCustomBrowser CustomBrowserFirefox];
    if ([browserType isEqualToString:@"edge"]) return RNAppAuthCustomBrowserEdge();
    return nil;
}
#endif

- (void)rejectPromise:(RCTPromiseRejectBlock)reject defaultCode:(NSString *)defaultCode error:(NSError *)error {
    if (error == nil) {
        reject(defaultCode, @"Unknown error", nil);
        return;
    }
    NSString *reason = [self getErrorReason:error];
    _dismissRequested = NO;

    // Only JSON-safe values: React Native serializes userInfo to JS.
    NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
    userInfo[NSLocalizedDescriptionKey] = error.localizedDescription ?: @"";
    userInfo[@"reason"] = reason;
    NSDictionary *response = error.userInfo[OIDOAuthErrorResponseErrorKey];
    if ([response isKindOfClass:[NSDictionary class]]) {
        if ([response[OIDOAuthErrorFieldErrorDescription] isKindOfClass:[NSString class]]) {
            userInfo[@"errorDescription"] = response[OIDOAuthErrorFieldErrorDescription];
        }
        if ([response[OIDOAuthErrorFieldErrorURI] isKindOfClass:[NSString class]]) {
            userInfo[@"errorUri"] = response[OIDOAuthErrorFieldErrorURI];
        }
    }
    NSError *underlying = error.userInfo[NSUnderlyingErrorKey];
    if ([underlying isKindOfClass:[NSError class]] && underlying.localizedDescription) {
        userInfo[@"nativeError"] = underlying.localizedDescription;
    }
    if (![reason isEqualToString:@"user_cancelled"] && ![reason isEqualToString:@"program_cancelled"] &&
        ![reason isEqualToString:@"network_error"]) {
        NSNumber *status = [self getHttpStatus:error];
        if (status != nil) {
            userInfo[@"httpStatus"] = status;
        }
    }
    NSError *rejection = [NSError errorWithDomain:error.domain code:error.code userInfo:userInfo];
    reject([self getErrorCode:error defaultCode:defaultCode], [self getErrorMessage:error], rejection);
}

@end
