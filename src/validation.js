import { invariant, isPlainObject } from './utils';

const validateIssuer = (issuer) => typeof issuer === 'string' && issuer.length > 0;

export const validateIssuerOrServiceConfigurationEndpoints = (issuer, serviceConfiguration) =>
  invariant(
    validateIssuer(issuer) ||
      (serviceConfiguration &&
        typeof serviceConfiguration.authorizationEndpoint === 'string' &&
        typeof serviceConfiguration.tokenEndpoint === 'string'),
    'Config error: you must provide either an issuer or a service endpoints'
  );

export const validateIssuerOrServiceConfigurationRegistrationEndpoint = (
  issuer,
  serviceConfiguration
) =>
  invariant(
    validateIssuer(issuer) ||
      (serviceConfiguration && typeof serviceConfiguration.registrationEndpoint === 'string'),
    'Config error: you must provide either an issuer or a registration endpoint'
  );

export const validateIssuerOrServiceConfigurationRevocationEndpoint = (
  issuer,
  serviceConfiguration
) =>
  invariant(
    validateIssuer(issuer) ||
      (serviceConfiguration && typeof serviceConfiguration.revocationEndpoint === 'string'),
    'Config error: you must provide either an issuer or a revocation endpoint'
  );

export const validateIssuerOrServiceConfigurationEndSessionEndpoint = (
  issuer,
  serviceConfiguration
) =>
  invariant(
    validateIssuer(issuer) ||
      (serviceConfiguration && typeof serviceConfiguration.endSessionEndpoint === 'string'),
    'Config error: you must provide either an issuer or an end session endpoint'
  );

export const validateClientId = (clientId) =>
  invariant(typeof clientId === 'string', 'Config error: clientId must be a string');

export const validateRedirectUrl = (redirectUrl) =>
  invariant(typeof redirectUrl === 'string', 'Config error: redirectUrl must be a string');

const isStringRecord = (value) =>
  isPlainObject(value) && Object.values(value).every((entry) => typeof entry === 'string');

export const validateHeaders = (headers) => {
  if (!headers) {
    return;
  }
  const message =
    'Config error: customHeaders type must be { token?: { [key: string]: string }, authorize?: { [key: string]: string }, register: { [key: string]: string }}';
  const authorizedKeys = ['token', 'authorize', 'register'];
  const keys = Object.keys(headers);
  invariant(keys.length > 0 && keys.every((key) => authorizedKeys.includes(key)), message);
  Object.values(headers).forEach((value) => invariant(isStringRecord(value), message));
};

export const validateAdditionalHeaders = (headers) => {
  if (!headers) {
    return;
  }
  invariant(
    isStringRecord(headers),
    'Config error: additionalHeaders must be { [key: string]: string }'
  );
};

export const validateConnectionTimeoutSeconds = (timeout) => {
  if (timeout === undefined || timeout === null) {
    return;
  }
  invariant(
    typeof timeout === 'number' && timeout > 0,
    'Config error: connectionTimeoutSeconds must be a positive number'
  );
};

export const validateClientAuthMethod = (method) =>
  invariant(
    method === 'basic' || method === 'post',
    "Config error: clientAuthMethod must be either 'basic' or 'post'"
  );

export const validateStringRecord = (value, name) => {
  if (value === undefined || value === null) {
    return;
  }
  invariant(isStringRecord(value), `Config error: ${name} must be { [key: string]: string }`);
};
