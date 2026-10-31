import { NativeModules, Platform } from 'react-native';
import { encodeFormComponent, base64Encode, invariant } from './utils';
import {
  validateAdditionalHeaders,
  validateClientAuthMethod,
  validateClientId,
  validateConnectionTimeoutSeconds,
  validateHeaders,
  validateIssuerOrServiceConfigurationEndSessionEndpoint,
  validateIssuerOrServiceConfigurationEndpoints,
  validateIssuerOrServiceConfigurationRegistrationEndpoint,
  validateIssuerOrServiceConfigurationRevocationEndpoint,
  validateRedirectUrl,
  validateStringRecord,
} from './validation';
import { createAppAuthError, ErrorReason, wrapNativeAuthPromise } from './errors';
import { normalizeBrowserOptions, withBrowserCallbacks } from './browser';
import { discoveryUrlForIssuer, getCachedServiceConfiguration } from './discovery';

const getNativeModule = () => {
  const module = NativeModules.RNAppAuth;
  invariant(
    module,
    "react-native-secure-auth: the native module 'RNAppAuth' is not linked. Rebuild the app after installing the package (and run `pod install` on iOS)."
  );
  return module;
};

export const SECOND_IN_MS = 1000;
export const DEFAULT_TIMEOUT_IOS = 60;
export const DEFAULT_TIMEOUT_ANDROID = 15;

const IOS_CUSTOM_BROWSERS = ['safari', 'chrome', 'opera', 'firefox', 'edge'];

export const convertTimeoutForPlatform = (
  platform,
  connectionTimeout = platform === 'ios' ? DEFAULT_TIMEOUT_IOS : DEFAULT_TIMEOUT_ANDROID
) => (platform === 'android' ? connectionTimeout * SECOND_IN_MS : connectionTimeout);

/**
 * Uses a configuration previously loaded with fetchServiceConfiguration() so the
 * native side can skip the discovery round trip.
 */
const resolveServiceConfiguration = (issuer, serviceConfiguration) =>
  serviceConfiguration || getCachedServiceConfiguration(issuer) || null;

const withResponseMode = (additionalParameters, responseMode) => {
  if (!responseMode) {
    return additionalParameters;
  }
  invariant(typeof responseMode === 'string', 'Config error: responseMode must be a string');
  return { ...(additionalParameters || {}), response_mode: responseMode };
};

const validateIosCustomBrowser = (browser) => {
  if (browser === null || browser === undefined) {
    return;
  }
  invariant(
    IOS_CUSTOM_BROWSERS.includes(browser),
    `Config error: iosCustomBrowser must be one of ${IOS_CUSTOM_BROWSERS.join(', ')}`
  );
};

export const prefetchConfiguration = async ({
  warmAndPrefetchChrome = false,
  issuer,
  redirectUrl,
  clientId,
  scopes,
  serviceConfiguration,
  dangerouslyAllowInsecureHttpRequests = false,
  customHeaders,
  connectionTimeoutSeconds,
}) => {
  if (Platform.OS !== 'android') {
    return;
  }
  validateIssuerOrServiceConfigurationEndpoints(issuer, serviceConfiguration);
  validateClientId(clientId);
  validateRedirectUrl(redirectUrl);
  validateHeaders(customHeaders);
  validateConnectionTimeoutSeconds(connectionTimeoutSeconds);

  await wrapNativeAuthPromise(
    getNativeModule().prefetchConfiguration(
      !!warmAndPrefetchChrome,
      issuer,
      redirectUrl,
      clientId,
      scopes,
      resolveServiceConfiguration(issuer, serviceConfiguration),
      !!dangerouslyAllowInsecureHttpRequests,
      customHeaders,
      convertTimeoutForPlatform(Platform.OS, connectionTimeoutSeconds)
    )
  );
};

export const register = ({
  issuer,
  redirectUrls,
  responseTypes,
  grantTypes,
  subjectType,
  tokenEndpointAuthMethod,
  additionalParameters,
  serviceConfiguration,
  dangerouslyAllowInsecureHttpRequests = false,
  customHeaders,
  additionalHeaders,
  connectionTimeoutSeconds,
}) => {
  validateIssuerOrServiceConfigurationRegistrationEndpoint(issuer, serviceConfiguration);
  validateHeaders(customHeaders);
  validateAdditionalHeaders(additionalHeaders);
  validateConnectionTimeoutSeconds(connectionTimeoutSeconds);
  invariant(
    Array.isArray(redirectUrls) && redirectUrls.every((url) => typeof url === 'string'),
    'Config error: redirectUrls must be an Array of strings'
  );
  invariant(
    responseTypes == null ||
      (Array.isArray(responseTypes) && responseTypes.every((rt) => typeof rt === 'string')),
    'Config error: if provided, responseTypes must be an Array of strings'
  );
  invariant(
    grantTypes == null ||
      (Array.isArray(grantTypes) && grantTypes.every((gt) => typeof gt === 'string')),
    'Config error: if provided, grantTypes must be an Array of strings'
  );
  invariant(
    subjectType == null || typeof subjectType === 'string',
    'Config error: if provided, subjectType must be a string'
  );
  invariant(
    tokenEndpointAuthMethod == null || typeof tokenEndpointAuthMethod === 'string',
    'Config error: if provided, tokenEndpointAuthMethod must be a string'
  );

  const nativeMethodArguments = [
    issuer,
    redirectUrls,
    responseTypes,
    grantTypes,
    subjectType,
    tokenEndpointAuthMethod,
    additionalParameters,
    resolveServiceConfiguration(issuer, serviceConfiguration),
    convertTimeoutForPlatform(Platform.OS, connectionTimeoutSeconds),
  ];

  if (Platform.OS === 'android') {
    nativeMethodArguments.push(!!dangerouslyAllowInsecureHttpRequests);
    nativeMethodArguments.push(customHeaders);
  }

  if (Platform.OS === 'ios') {
    nativeMethodArguments.push(additionalHeaders);
  }

  return wrapNativeAuthPromise(getNativeModule().register(...nativeMethodArguments));
};

export const authorize = ({
  issuer,
  redirectUrl,
  clientId,
  clientSecret,
  scopes,
  useNonce = true,
  usePKCE = true,
  additionalParameters,
  responseMode,
  serviceConfiguration,
  clientAuthMethod = 'basic',
  dangerouslyAllowInsecureHttpRequests = false,
  customHeaders,
  additionalHeaders,
  skipCodeExchange = false,
  iosCustomBrowser = null,
  androidAllowCustomBrowsers = null,
  androidTrustedWebActivity = false,
  connectionTimeoutSeconds,
  iosPrefersEphemeralSession = false,
  androidPrefersEphemeralSession = false,
  browser,
}) => {
  validateIssuerOrServiceConfigurationEndpoints(issuer, serviceConfiguration);
  validateClientId(clientId);
  validateRedirectUrl(redirectUrl);
  validateHeaders(customHeaders);
  validateAdditionalHeaders(additionalHeaders);
  validateConnectionTimeoutSeconds(connectionTimeoutSeconds);
  validateClientAuthMethod(clientAuthMethod);
  validateStringRecord(additionalParameters, 'additionalParameters');
  validateIosCustomBrowser(iosCustomBrowser);

  const browserOptions = normalizeBrowserOptions(browser, Platform.OS);
  const parameters = withResponseMode(additionalParameters, responseMode);

  const nativeMethodArguments = [
    issuer,
    redirectUrl,
    clientId,
    clientSecret,
    scopes,
    parameters,
    resolveServiceConfiguration(issuer, serviceConfiguration),
    !!skipCodeExchange,
    convertTimeoutForPlatform(Platform.OS, connectionTimeoutSeconds),
  ];

  if (Platform.OS === 'android') {
    nativeMethodArguments.push(!!useNonce);
    nativeMethodArguments.push(!!usePKCE);
    nativeMethodArguments.push(clientAuthMethod);
    nativeMethodArguments.push(!!dangerouslyAllowInsecureHttpRequests);
    nativeMethodArguments.push(customHeaders);
    nativeMethodArguments.push(androidAllowCustomBrowsers);
    nativeMethodArguments.push(!!androidTrustedWebActivity);
    nativeMethodArguments.push(!!androidPrefersEphemeralSession);
    nativeMethodArguments.push(browserOptions);
  }

  if (Platform.OS === 'ios') {
    nativeMethodArguments.push(additionalHeaders);
    nativeMethodArguments.push(!!useNonce);
    nativeMethodArguments.push(!!usePKCE);
    nativeMethodArguments.push(iosCustomBrowser);
    nativeMethodArguments.push(!!iosPrefersEphemeralSession);
    nativeMethodArguments.push(clientAuthMethod);
    nativeMethodArguments.push(browserOptions);
  }

  return withBrowserCallbacks(browser, () =>
    wrapNativeAuthPromise(getNativeModule().authorize(...nativeMethodArguments))
  );
};

export const resumePendingAuthorize = ({
  additionalParameters,
  clientSecret,
  clientAuthMethod = 'basic',
  skipCodeExchange = false,
  dangerouslyAllowInsecureHttpRequests = false,
  customHeaders,
  connectionTimeoutSeconds,
} = {}) => {
  const platform = Platform.OS;
  if (platform !== 'android') {
    return Promise.resolve(null);
  }

  validateHeaders(customHeaders);
  validateConnectionTimeoutSeconds(connectionTimeoutSeconds);
  validateClientAuthMethod(clientAuthMethod);

  return wrapNativeAuthPromise(
    getNativeModule().resumePendingAuthorize(
      additionalParameters,
      convertTimeoutForPlatform(platform, connectionTimeoutSeconds),
      customHeaders,
      !!dangerouslyAllowInsecureHttpRequests,
      clientSecret,
      clientAuthMethod,
      !!skipCodeExchange
    )
  );
};

export const refresh = (
  {
    issuer,
    redirectUrl,
    clientId,
    clientSecret,
    scopes,
    additionalParameters = {},
    serviceConfiguration,
    clientAuthMethod = 'basic',
    dangerouslyAllowInsecureHttpRequests = false,
    customHeaders,
    additionalHeaders,
    iosCustomBrowser = null,
    androidAllowCustomBrowsers = null,
    connectionTimeoutSeconds,
  },
  { refreshToken } = {}
) => {
  validateIssuerOrServiceConfigurationEndpoints(issuer, serviceConfiguration);
  validateClientId(clientId);
  validateRedirectUrl(redirectUrl);
  validateHeaders(customHeaders);
  validateAdditionalHeaders(additionalHeaders);
  validateConnectionTimeoutSeconds(connectionTimeoutSeconds);
  validateClientAuthMethod(clientAuthMethod);
  invariant(refreshToken, 'Please pass in a refresh token');

  const nativeMethodArguments = [
    issuer,
    redirectUrl,
    clientId,
    clientSecret,
    refreshToken,
    scopes,
    additionalParameters,
    resolveServiceConfiguration(issuer, serviceConfiguration),
    convertTimeoutForPlatform(Platform.OS, connectionTimeoutSeconds),
  ];

  if (Platform.OS === 'android') {
    nativeMethodArguments.push(clientAuthMethod);
    nativeMethodArguments.push(!!dangerouslyAllowInsecureHttpRequests);
    nativeMethodArguments.push(customHeaders);
    nativeMethodArguments.push(androidAllowCustomBrowsers);
  }

  if (Platform.OS === 'ios') {
    nativeMethodArguments.push(additionalHeaders);
    nativeMethodArguments.push(iosCustomBrowser);
    nativeMethodArguments.push(clientAuthMethod);
  }

  return wrapNativeAuthPromise(getNativeModule().refresh(...nativeMethodArguments));
};

export const revoke = async (
  { clientId, issuer, serviceConfiguration, clientSecret },
  { tokenToRevoke, sendClientId = false, includeBasicAuth = false, tokenTypeHint } = {}
) => {
  invariant(tokenToRevoke, 'Please include the token to revoke');
  validateClientId(clientId);
  const resolvedConfiguration = resolveServiceConfiguration(issuer, serviceConfiguration);
  validateIssuerOrServiceConfigurationRevocationEndpoint(issuer, resolvedConfiguration);

  let revocationEndpoint;
  if (resolvedConfiguration && resolvedConfiguration.revocationEndpoint) {
    revocationEndpoint = resolvedConfiguration.revocationEndpoint;
  } else {
    const response = await fetch(discoveryUrlForIssuer(issuer));
    const openidConfig = await response.json();
    invariant(
      openidConfig.revocation_endpoint,
      'The openid config does not specify a revocation endpoint'
    );
    revocationEndpoint = openidConfig.revocation_endpoint;
  }

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (includeBasicAuth) {
    headers.Authorization = `Basic ${base64Encode(`${clientId}:${clientSecret}`)}`;
  }

  // RFC 7009 does not require client_id in the body; some servers (IdentityServer) do.
  let body = `token=${encodeFormComponent(tokenToRevoke)}`;
  if (sendClientId) {
    body += `&client_id=${encodeFormComponent(clientId)}`;
  }
  if (tokenTypeHint) {
    body += `&token_type_hint=${encodeFormComponent(tokenTypeHint)}`;
  }

  let response;
  try {
    response = await fetch(revocationEndpoint, { method: 'POST', headers, body });
  } catch (error) {
    throw createAppAuthError('revoke_failed', 'Failed to revoke token', {
      reason: ErrorReason.NETWORK_ERROR,
      nativeError: error && error.message,
    });
  }
  return response;
};

export const logout = (
  {
    issuer,
    serviceConfiguration,
    additionalParameters,
    dangerouslyAllowInsecureHttpRequests = false,
    iosCustomBrowser = null,
    iosPrefersEphemeralSession = false,
    androidAllowCustomBrowsers = null,
    androidPrefersEphemeralSession = false,
    browser,
  },
  { idToken, postLogoutRedirectUrl } = {}
) => {
  validateIssuerOrServiceConfigurationEndSessionEndpoint(issuer, serviceConfiguration);
  validateRedirectUrl(postLogoutRedirectUrl);
  validateIosCustomBrowser(iosCustomBrowser);
  invariant(idToken, 'Please pass in the ID token');

  const browserOptions = normalizeBrowserOptions(browser, Platform.OS);

  const nativeMethodArguments = [
    issuer,
    idToken,
    postLogoutRedirectUrl,
    resolveServiceConfiguration(issuer, serviceConfiguration),
    additionalParameters,
  ];

  if (Platform.OS === 'android') {
    nativeMethodArguments.push(!!dangerouslyAllowInsecureHttpRequests);
    nativeMethodArguments.push(androidAllowCustomBrowsers);
    nativeMethodArguments.push(!!androidPrefersEphemeralSession);
    nativeMethodArguments.push(browserOptions);
  }

  if (Platform.OS === 'ios') {
    nativeMethodArguments.push(iosCustomBrowser);
    nativeMethodArguments.push(!!iosPrefersEphemeralSession);
    nativeMethodArguments.push(browserOptions);
  }

  return withBrowserCallbacks(browser, () =>
    wrapNativeAuthPromise(getNativeModule().logout(...nativeMethodArguments))
  );
};
