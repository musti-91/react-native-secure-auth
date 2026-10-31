import type { ColorValue, EmitterSubscription } from 'react-native';
import type { ComponentType, ReactElement, ReactNode } from 'react';

export interface ServiceConfiguration {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  registrationEndpoint?: string;
  endSessionEndpoint?: string;
  userInfoEndpoint?: string;
  introspectionEndpoint?: string;
  jwksUri?: string;
  issuer?: string;
  /**
   * Raw OpenID discovery document. When present, the native layers build the
   * configuration from it, which keeps ID token issuer validation enabled.
   */
  discoveryDocument?: Record<string, unknown>;
}

export type BaseConfiguration =
  | {
      issuer?: string;
      serviceConfiguration: ServiceConfiguration;
    }
  | {
      issuer: string;
      serviceConfiguration?: ServiceConfiguration;
    };

type CustomHeaders = {
  authorize?: Record<string, string>;
  token?: Record<string, string>;
  register?: Record<string, string>;
};

type AdditionalHeaders = Record<string, string>;

/** Any React Native color value: '#RRGGBB', '#RRGGBBAA', 'rgb()', 'red', ... */
export type ColorValue = string;

export interface BrowserHeaderColors {
  /** Toolbar / navigation bar background. Custom Tabs, SFSafariViewController, web view. */
  backgroundColor?: ColorValue;
  /** Buttons tint. SFSafariViewController, web view. */
  tintColor?: ColorValue;
  /** Title / subtitle text color. Web view only. */
  titleColor?: ColorValue;
  /** Custom Tabs secondary (bottom) toolbar color. */
  secondaryColor?: ColorValue;
  /** Android system navigation bar color. Custom Tabs, web view. */
  navigationBarColor?: ColorValue;
  /** Android system navigation bar divider color. Custom Tabs. */
  navigationBarDividerColor?: ColorValue;
  /** Progress bar color. Web view only. */
  progressColor?: ColorValue;
}

export interface BrowserHeaderButton {
  /** Identifier sent back in the `headerButtonPress` event. */
  id: string;
  title: string;
  /** Defaults to 'end'. */
  position?: 'start' | 'end';
}

export interface BrowserHeaderOptions extends BrowserHeaderColors {
  /** Colors applied when the system (or `colorScheme`) is dark. */
  dark?: BrowserHeaderColors;
  /** Fixed title. Web view only (other user agents show the page title). */
  title?: string;
  /** Show the page title in the toolbar. Custom Tabs, web view. */
  showTitle?: boolean;
  /** Show the current host under the title. Web view only. */
  showUrl?: boolean;
  /** Hide the header entirely. Web view only. */
  hidden?: boolean;
  /** Collapse the toolbar on scroll. Custom Tabs (url bar hiding), SFSafariViewController (bar collapsing). */
  hideUrlBarOnScroll?: boolean;
  /** Show the share action. Custom Tabs only. */
  shareButton?: boolean;
  /** Show a loading progress bar. Web view only. */
  showProgress?: boolean;
  /** Force light/dark. Custom Tabs, web view. */
  colorScheme?: 'system' | 'light' | 'dark';
  closeButton?: {
    /** Custom Tabs (Chrome), web view. */
    position?: 'start' | 'end';
    /**
     * 'close' (X) / 'back' (arrow): Custom Tabs, web view.
     * 'done' / 'close' / 'cancel': SFSafariViewController dismiss button style, web view.
     */
    style?: 'close' | 'back' | 'done' | 'cancel';
    /** Text label instead of an icon. Web view only. */
    text?: string;
    /** Web view only. */
    hidden?: boolean;
  };
  /**
   * Extra header buttons. Emits `headerButtonPress` events.
   * Web view: toolbar buttons. Custom Tabs: overflow menu items. Not supported by
   * SFSafariViewController / ASWebAuthenticationSession.
   */
  buttons?: BrowserHeaderButton[];
}

export interface BrowserMessagingOptions {
  /** Defaults to true for the web view mode and when an Android origin is configured. */
  enabled?: boolean;
  /** Messages delivered to the page as soon as the messaging channel is ready. */
  initialMessages?: unknown[];
  /**
   * Android Custom Tabs: the origin your app is allowed to post messages as. It must be
   * associated with your app through Digital Asset Links
   * (`delegate_permission/common.use_as_origin`).
   */
  androidOrigin?: string;
  /**
   * Web view modes: name of the `window` object exposed to the page (default `RNAppAuth`), e.g.
   * `'myapp'` gives `window.myapp.postMessage()` and a `myappready` event. Must be a valid
   * JavaScript identifier.
   */
  bridgeName?: string;
  /** Android Custom Tabs: restrict messages to this page origin. */
  androidTargetOrigin?: string;
  /** Web view: only exchange messages with pages served from these origins. */
  allowedOrigins?: string[];
}

export type BrowserEventType =
  | 'opened'
  | 'closed'
  | 'navigationStarted'
  | 'navigationFinished'
  | 'navigationFailed'
  | 'navigationAborted'
  | 'tabShown'
  | 'tabHidden'
  | 'messageChannelReady'
  | 'messageChannelFailed'
  | 'message'
  | 'deeplink'
  | 'headerButtonPress';

export interface BrowserEvent {
  type: BrowserEventType;
  /** 'customTab' | 'webView' | 'system' | 'safariViewController' */
  mode?: string;
  url?: string;
  /** For `message` events: the raw string payload. */
  data?: string;
  origin?: string;
  /** For `headerButtonPress` events. */
  buttonId?: string;
  error?: string;
  /**
   * For `deeplink` events: 'delivered', 'queued' (channel not ready), 'unsupported', or 'notOpen'
   * (no web view was open when the link arrived).
   */
  result?: 'delivered' | 'queued' | 'unsupported' | 'notOpen';
}

export interface BrowserLoaderOptions {
  backgroundColor?: ColorValue;
  /** Fade-out duration in ms once the first page has loaded. Default 200. */
  fadeDuration?: number;
}

export interface AppAuthProviderProps extends BrowserLoaderOptions {
  /** Element or component shown over the embedded web view until the first page loads. */
  loader: ReactElement | ComponentType<any>;
  children?: ReactNode;
}

/**
 * Provides the loader for the embedded web view modes. Custom Tabs, SFSafariViewController and
 * ASWebAuthenticationSession are drawn by the system and can't show a loader.
 */
export function AppAuthProvider(props: AppAuthProviderProps): ReactNode;

export interface BrowserOptions {
  /**
   * iOS user agent:
   * - 'system' (default): ASWebAuthenticationSession (AppAuth default) or `iosCustomBrowser`.
   * - 'safariViewController': SFSafariViewController with a customizable header.
   * - 'webView': embedded WKWebView with fully custom header and two-way postMessage.
   */
  iosMode?: 'system' | 'safariViewController' | 'webView';
  /**
   * Android user agent:
   * - 'customTab' (default): Custom Tabs with customizable header, partial tabs and postMessage.
   * - 'webView': embedded WebView with fully custom header and two-way postMessage.
   */
  androidMode?: 'customTab' | 'webView';
  header?: BrowserHeaderOptions;
  /**
   * Web view only. Needs an `<AppAuthProvider loader={...}>` mounted in the app.
   * `false` disables the loader for this call; an object overrides the provider's values.
   */
  loader?: false | BrowserLoaderOptions;
  /**
   * HTTP headers sent with the authorization/end-session page request.
   * Web view: always. Android Custom Tabs: CORS-safelisted headers, others need Digital
   * Asset Links. iOS 'system' mode: iOS 17.4+.
   */
  headers?: Record<string, string>;
  /** Custom User-Agent. Web view only. */
  userAgent?: string;
  messaging?: BrowserMessagingOptions;
  /** iOS modal presentation style for SFSafariViewController / web view. */
  iosPresentationStyle?:
    'automatic' | 'fullScreen' | 'pageSheet' | 'formSheet' | 'overFullScreen' | 'popover';
  /** iOS: prevent swipe-to-dismiss for sheet presentations. */
  iosModalInPresentation?: boolean;
  /** SFSafariViewController reader mode. */
  iosEntersReaderIfAvailable?: boolean;
  /** Android Partial Custom Tab (bottom sheet / side sheet). Sizes are in dp. */
  androidPartial?: {
    height?: number;
    width?: number;
    breakpoint?: number;
    cornerRadius?: number;
    /** Allow the user to resize the bottom sheet (default true). */
    resizable?: boolean;
    /** Allow interacting with the app behind the sheet. */
    backgroundInteraction?: boolean;
  };
  androidAnimation?: 'default' | 'slide' | 'fade' | 'none';
  /** Web view mode: start with empty cookies / storage. */
  clearWebViewData?: boolean;
  /** Web view mode: hosts allowed to load inside the web view; others open in the system browser. */
  webViewAllowedHosts?: string[];
  /**
   * Android web view: deep links forwarded to the page as `{type:'deeplink', url, code, state}`.
   * Each entry is `scheme://host/path`, or `host/path` to match any scheme (e.g. `login`).
   * A trailing `*` matches any suffix. Query strings are ignored. Default: every link routed to the web view.
   */
  androidDeepLinkUrls?: string[];
  /** Called for messages posted by the page while this flow is running. */
  onMessage?: (message: unknown, event: BrowserEvent) => void;
  /** Called for every browser event while this flow is running. */
  onEvent?: (event: BrowserEvent) => void;
}

interface BuiltInRegistrationParameters {
  client_name?: string;
  logo_uri?: string;
  client_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
}

export type RegistrationConfiguration = BaseConfiguration & {
  redirectUrls: string[];
  responseTypes?: string[];
  grantTypes?: string[];
  subjectType?: string;
  tokenEndpointAuthMethod?: string;
  additionalParameters?: BuiltInRegistrationParameters & { [name: string]: string };
  dangerouslyAllowInsecureHttpRequests?: boolean;
  customHeaders?: CustomHeaders;
  additionalHeaders?: AdditionalHeaders;
  connectionTimeoutSeconds?: number;
};

export interface RegistrationResponse {
  clientId: string;
  additionalParameters?: { [name: string]: string };
  clientIdIssuedAt?: string;
  clientSecret?: string;
  clientSecretExpiresAt?: string;
  registrationAccessToken?: string;
  registrationClientUri?: string;
  tokenEndpointAuthMethod?: string;
}

interface BuiltInParameters {
  display?: 'page' | 'popup' | 'touch' | 'wap';
  login_prompt?: string;
  prompt?: 'consent' | 'login' | 'none' | 'select_account' | 'create';
}

export type BaseAuthConfiguration = BaseConfiguration & {
  clientId: string;
};

export type AndroidCustomBrowser =
  'chrome' | 'chromeCustomTab' | 'firefox' | 'firefoxCustomTab' | 'samsung' | 'samsungCustomTab';

export type AuthConfiguration = BaseAuthConfiguration & {
  clientSecret?: string;
  scopes: string[];
  redirectUrl: string;
  additionalParameters?: BuiltInParameters & { [name: string]: string };
  /** Sets the `response_mode` authorization parameter (e.g. 'query', 'fragment'). */
  responseMode?: string;
  /** How the client secret is sent to the token endpoint. Both platforms. */
  clientAuthMethod?: 'basic' | 'post';
  dangerouslyAllowInsecureHttpRequests?: boolean;
  customHeaders?: CustomHeaders;
  additionalHeaders?: AdditionalHeaders;
  connectionTimeoutSeconds?: number;
  useNonce?: boolean;
  usePKCE?: boolean;
  warmAndPrefetchChrome?: boolean;
  skipCodeExchange?: boolean;
  iosCustomBrowser?: 'safari' | 'chrome' | 'opera' | 'firefox' | 'edge';
  androidAllowCustomBrowsers?: AndroidCustomBrowser[];
  androidTrustedWebActivity?: boolean;
  androidPrefersEphemeralSession?: boolean;
  iosPrefersEphemeralSession?: boolean;
  /** Browser appearance (header), messaging and presentation options. */
  browser?: BrowserOptions;
};

export type EndSessionConfiguration = BaseConfiguration & {
  clientId?: string;
  additionalParameters?: { [name: string]: string };
  dangerouslyAllowInsecureHttpRequests?: boolean;
  iosCustomBrowser?: 'safari' | 'chrome' | 'opera' | 'firefox' | 'edge';
  iosPrefersEphemeralSession?: boolean;
  androidAllowCustomBrowsers?: AndroidCustomBrowser[];
  androidPrefersEphemeralSession?: boolean;
  browser?: BrowserOptions;
};

export interface AuthorizeResult {
  accessToken: string;
  accessTokenExpirationDate: string;
  authorizeAdditionalParameters?: { [name: string]: string };
  tokenAdditionalParameters?: { [name: string]: string };
  idToken: string;
  refreshToken: string;
  tokenType: string;
  scopes: string[];
  authorizationCode: string;
  state?: string;
  codeVerifier?: string;
}

export interface RefreshResult {
  accessToken: string;
  accessTokenExpirationDate: string;
  additionalParameters?: { [name: string]: string };
  idToken: string;
  refreshToken: string | null;
  tokenType: string;
}

export interface RevokeConfiguration {
  tokenToRevoke: string;
  sendClientId?: boolean;
  includeBasicAuth?: boolean;
  tokenTypeHint?: 'access_token' | 'refresh_token';
}

export interface RefreshConfiguration {
  refreshToken: string;
}

export interface LogoutConfiguration {
  idToken: string;
  postLogoutRedirectUrl: string;
}

export interface EndSessionResult {
  idTokenHint: string;
  postLogoutRedirectUri: string;
  state: string;
}

export function prefetchConfiguration(config: AuthConfiguration): Promise<void>;

export function register(config: RegistrationConfiguration): Promise<RegistrationResponse>;

export function authorize(config: AuthConfiguration): Promise<AuthorizeResult>;

export type ResumePendingAuthorizeConfiguration = {
  additionalParameters?: { [name: string]: string };
  clientSecret?: string;
  clientAuthMethod?: 'basic' | 'post';
  skipCodeExchange?: boolean;
  dangerouslyAllowInsecureHttpRequests?: boolean;
  customHeaders?: CustomHeaders;
  connectionTimeoutSeconds?: number;
};

export function resumePendingAuthorize(
  config?: ResumePendingAuthorizeConfiguration
): Promise<AuthorizeResult | null>;

export function refresh(
  config: AuthConfiguration,
  refreshConfig: RefreshConfiguration
): Promise<RefreshResult>;

export function revoke(
  config: BaseAuthConfiguration & { clientSecret?: string },
  revokeConfig: RevokeConfiguration
): Promise<Response>;

export function logout(
  config: EndSessionConfiguration,
  logoutConfig: LogoutConfiguration
): Promise<EndSessionResult>;

// ---- Browser messaging & control ----

export type PostMessageResult = 'delivered' | 'queued' | 'unsupported';

/**
 * Sends a message (string, or JSON-serializable value) to the page loaded in the
 * authorization/logout browser. Messages sent while no browser is open are queued
 * and delivered as soon as the next browser opens its messaging channel.
 *
 * With `throwIfNotOpen`, the message is never queued: the promise rejects with a `PostMessageError`
 * unless the message was delivered right away (no browser open, channel not ready, or messaging
 * unsupported). Already queued messages are left untouched.
 */
export interface PostMessageOptions {
  throwIfNotOpen?: boolean;
}
export interface PostMessageError extends Error {
  code: 'message_not_delivered';
  result: 'notOpen' | 'unsupported';
}
export function postMessage(
  message: unknown,
  options?: PostMessageOptions
): Promise<PostMessageResult>;
export function clearPendingMessages(): Promise<void>;
export function addBrowserEventListener(
  listener: (event: BrowserEvent) => void
): EmitterSubscription;
export function addMessageListener(
  listener: (message: unknown, event: BrowserEvent) => void
): EmitterSubscription;
/** Closes the browser; the pending authorize()/logout() rejects with reason 'program_cancelled'. */
export function dismissBrowser(): Promise<boolean>;
/** Clears cookies and website data of the embedded web view mode. */
export function clearWebViewData(): Promise<void>;

// ---- Discovery ----

export interface FetchServiceConfigurationOptions {
  issuer: string;
  headers?: Record<string, string>;
  connectionTimeoutSeconds?: number;
  forceRefresh?: boolean;
}

export function fetchServiceConfiguration(
  options: FetchServiceConfigurationOptions
): Promise<ServiceConfiguration & { discoveryDocument: Record<string, unknown> }>;
export function getCachedServiceConfiguration(issuer: string): ServiceConfiguration | null;
export function setCachedServiceConfiguration(
  issuer: string,
  serviceConfiguration: ServiceConfiguration
): void;
export function clearServiceConfigurationCache(issuer?: string): void;
export function serviceConfigurationFromDiscoveryDocument(
  document: Record<string, unknown>
): ServiceConfiguration & { discoveryDocument: Record<string, unknown> };
export function fetchUserInfo<T = Record<string, unknown>>(
  config: {
    issuer?: string;
    serviceConfiguration?: Partial<ServiceConfiguration>;
    connectionTimeoutSeconds?: number;
    additionalHeaders?: Record<string, string>;
  },
  options: { accessToken: string; tokenType?: string }
): Promise<T>;

// ---- Tokens ----

export interface DecodedJwt<T = Record<string, unknown>> {
  header: Record<string, unknown>;
  payload: T;
  signature: string;
}

/** Decodes a JWT without verifying its signature. */
export function decodeJwt<T = Record<string, unknown>>(token: string): DecodedJwt<T>;

export function isTokenExpired(
  expirationDate: string | number | Date | null | undefined,
  leewaySeconds?: number,
  now?: number
): boolean;

export interface TokenSet {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpirationDate?: string;
  idToken?: string;
}

export interface TokenRefresherOptions {
  /** Refresh this many seconds before expiry. Default 60. */
  leewaySeconds?: number;
  /** Delay before retrying after a network error. Default 30. */
  retryDelaySeconds?: number;
  maxNetworkRetries?: number;
  onRefresh?: (result: RefreshResult, tokens: TokenSet) => void;
  /** Called on a non-recoverable error; the refresher stops. */
  onError?: (error: AppAuthError) => void;
}

export interface TokenRefresher {
  start(): TokenRefresher;
  stop(): void;
  refreshNow(): Promise<RefreshResult>;
  getValidAccessToken(): Promise<string | undefined>;
  getTokens(): TokenSet;
  isRunning(): boolean;
}

export function createTokenRefresher(
  config: AuthConfiguration,
  tokens: TokenSet,
  options?: TokenRefresherOptions
): TokenRefresher;

// ---- Errors ----

// https://tools.ietf.org/html/rfc6749#section-4.1.2.1
type OAuthAuthorizationErrorCode =
  | 'unauthorized_client'
  | 'access_denied'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'server_error'
  | 'temporarily_unavailable';
// https://tools.ietf.org/html/rfc6749#section-5.2
type OAuthTokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope';
// https://openid.net/specs/openid-connect-registration-1_0.html#RegistrationError
type OICRegistrationErrorCode = 'invalid_redirect_uri' | 'invalid_client_metadata';
type AppAuthErrorCode =
  | 'service_configuration_fetch_error'
  | 'authentication_failed'
  | 'authentication_in_progress'
  | 'token_refresh_failed'
  | 'token_exchange_failed'
  | 'registration_failed'
  | 'browser_not_found'
  | 'end_session_failed'
  | 'authentication_error'
  | 'run_time_exception'
  | 'revoke_failed'
  | 'userinfo_failed';

type ErrorCode =
  OAuthAuthorizationErrorCode | OAuthTokenErrorCode | OICRegistrationErrorCode | AppAuthErrorCode;

export type AppAuthErrorReason =
  | 'user_cancelled'
  | 'program_cancelled'
  | 'network_error'
  | 'server_error'
  | 'oauth_error'
  | 'invalid_response'
  | 'id_token_validation'
  | 'browser_not_found'
  | 'in_progress'
  | 'configuration'
  | 'unknown';

export const ErrorReason: {
  readonly USER_CANCELLED: 'user_cancelled';
  readonly PROGRAM_CANCELLED: 'program_cancelled';
  readonly NETWORK_ERROR: 'network_error';
  readonly SERVER_ERROR: 'server_error';
  readonly OAUTH_ERROR: 'oauth_error';
  readonly INVALID_RESPONSE: 'invalid_response';
  readonly ID_TOKEN_VALIDATION: 'id_token_validation';
  readonly BROWSER_NOT_FOUND: 'browser_not_found';
  readonly IN_PROGRESS: 'in_progress';
  readonly CONFIGURATION: 'configuration';
  readonly UNKNOWN: 'unknown';
};

export interface AppAuthError extends Error {
  code: ErrorCode | string;
  /** Platform independent category of the failure. */
  reason: AppAuthErrorReason;
  /** HTTP status of the failed token / registration / discovery response, when known. */
  httpStatus?: number;
  /** OAuth `error_description`, when provided by the server. */
  errorDescription?: string;
  errorUri?: string;
  nativeError?: string;
  userInfo?: Record<string, unknown>;
}

export function getErrorReason(error: unknown): AppAuthErrorReason;
export function isNetworkError(error: unknown): boolean;
export function isUserCancelledError(error: unknown): boolean;

export const SECOND_IN_MS: number;
export const DEFAULT_TIMEOUT_IOS: number;
export const DEFAULT_TIMEOUT_ANDROID: number;
