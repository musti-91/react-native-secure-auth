import { invariant, isPlainObject, stripTrailingSlash } from './utils';
import { createAppAuthError, ErrorReason } from './errors';

const cache = new Map();

const ENDPOINT_MAPPING = {
  authorization_endpoint: 'authorizationEndpoint',
  token_endpoint: 'tokenEndpoint',
  revocation_endpoint: 'revocationEndpoint',
  registration_endpoint: 'registrationEndpoint',
  end_session_endpoint: 'endSessionEndpoint',
  userinfo_endpoint: 'userInfoEndpoint',
  introspection_endpoint: 'introspectionEndpoint',
  jwks_uri: 'jwksUri',
};

export const discoveryUrlForIssuer = (issuer) =>
  `${stripTrailingSlash(issuer)}/.well-known/openid-configuration`;

/**
 * Maps an OpenID discovery document to the `serviceConfiguration` shape accepted by
 * authorize/refresh/logout/register. The raw document is kept under
 * `discoveryDocument`, which lets the native layers build a configuration that still
 * validates the ID token issuer.
 */
export const serviceConfigurationFromDiscoveryDocument = (document) => {
  invariant(isPlainObject(document), 'Discovery document must be an object');
  const configuration = { discoveryDocument: document };
  Object.keys(ENDPOINT_MAPPING).forEach((key) => {
    if (typeof document[key] === 'string') {
      configuration[ENDPOINT_MAPPING[key]] = document[key];
    }
  });
  if (typeof document.issuer === 'string') {
    configuration.issuer = document.issuer;
  }
  return configuration;
};

const withTimeout = (promise, timeoutSeconds, controller) => {
  if (!timeoutSeconds) {
    return promise;
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) {
        controller.abort();
      }
      reject(
        createAppAuthError('service_configuration_fetch_error', 'Request timed out', {
          reason: ErrorReason.NETWORK_ERROR,
        })
      );
    }, timeoutSeconds * 1000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const requestJson = async (
  url,
  { headers, connectionTimeoutSeconds, errorCode, method = 'GET' }
) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let response;
  try {
    response = await withTimeout(
      fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(headers || {}) },
        signal: controller ? controller.signal : undefined,
      }),
      connectionTimeoutSeconds,
      controller
    );
  } catch (error) {
    if (error && error.code) {
      throw error;
    }
    throw createAppAuthError(errorCode, (error && error.message) || 'Network request failed', {
      reason: ErrorReason.NETWORK_ERROR,
      nativeError: error && error.message,
    });
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw createAppAuthError(errorCode, 'Response is not valid JSON', {
      reason: ErrorReason.INVALID_RESPONSE,
      httpStatus: response.status,
    });
  }

  if (!response.ok) {
    throw createAppAuthError(
      (body && body.error) || errorCode,
      (body && body.error_description) || `Request failed with status ${response.status}`,
      {
        reason: response.status >= 500 ? ErrorReason.SERVER_ERROR : ErrorReason.OAUTH_ERROR,
        httpStatus: response.status,
        errorDescription: body && body.error_description,
      }
    );
  }
  return body;
};

/**
 * Fetches (and caches) the OpenID Connect discovery document of an issuer.
 * Resolves with a `serviceConfiguration` object that can be passed to every
 * other method, plus all raw fields in `discoveryDocument` (e.g. userinfo_endpoint).
 */
export const fetchServiceConfiguration = async ({
  issuer,
  headers,
  connectionTimeoutSeconds,
  forceRefresh = false,
} = {}) => {
  invariant(
    typeof issuer === 'string' && issuer.length > 0,
    'Config error: issuer must be a string'
  );
  const key = stripTrailingSlash(issuer);
  if (!forceRefresh && cache.has(key)) {
    return cache.get(key);
  }
  const document = await requestJson(discoveryUrlForIssuer(issuer), {
    headers,
    connectionTimeoutSeconds,
    errorCode: 'service_configuration_fetch_error',
  });
  invariant(isPlainObject(document), 'Discovery document must be a JSON object');
  if (
    typeof document.authorization_endpoint !== 'string' ||
    typeof document.token_endpoint !== 'string'
  ) {
    throw createAppAuthError(
      'service_configuration_fetch_error',
      'Discovery document is missing authorization_endpoint or token_endpoint',
      { reason: ErrorReason.INVALID_RESPONSE }
    );
  }
  const configuration = serviceConfigurationFromDiscoveryDocument(document);
  cache.set(key, configuration);
  return configuration;
};

export const getCachedServiceConfiguration = (issuer) =>
  issuer ? cache.get(stripTrailingSlash(issuer)) || null : null;

export const setCachedServiceConfiguration = (issuer, serviceConfiguration) => {
  invariant(typeof issuer === 'string' && issuer.length > 0, 'issuer must be a string');
  invariant(isPlainObject(serviceConfiguration), 'serviceConfiguration must be an object');
  cache.set(stripTrailingSlash(issuer), serviceConfiguration);
};

export const clearServiceConfigurationCache = (issuer) => {
  if (issuer) {
    cache.delete(stripTrailingSlash(issuer));
  } else {
    cache.clear();
  }
};

/**
 * Calls the OpenID Connect userinfo endpoint.
 */
export const fetchUserInfo = async (
  { issuer, serviceConfiguration, connectionTimeoutSeconds, additionalHeaders },
  { accessToken, tokenType = 'Bearer' }
) => {
  invariant(accessToken, 'Please pass in an access token');
  let endpoint = serviceConfiguration && serviceConfiguration.userInfoEndpoint;
  if (!endpoint) {
    invariant(
      typeof issuer === 'string',
      'Config error: you must provide either an issuer or serviceConfiguration.userInfoEndpoint'
    );
    const discovered = await fetchServiceConfiguration({ issuer, connectionTimeoutSeconds });
    endpoint = discovered.userInfoEndpoint;
    invariant(endpoint, 'The openid config does not specify a userinfo endpoint');
  }
  return requestJson(endpoint, {
    headers: { ...(additionalHeaders || {}), Authorization: `${tokenType} ${accessToken}` },
    connectionTimeoutSeconds,
    errorCode: 'userinfo_failed',
  });
};
