/**
 * Coarse error categories attached to every native rejection as `error.reason`.
 * They are stable across iOS and Android, unlike `error.code` (which keeps the
 * historical, partially provider-specific values for backwards compatibility).
 */
export const ErrorReason = Object.freeze({
  USER_CANCELLED: 'user_cancelled',
  PROGRAM_CANCELLED: 'program_cancelled',
  NETWORK_ERROR: 'network_error',
  SERVER_ERROR: 'server_error',
  OAUTH_ERROR: 'oauth_error',
  INVALID_RESPONSE: 'invalid_response',
  ID_TOKEN_VALIDATION: 'id_token_validation',
  BROWSER_NOT_FOUND: 'browser_not_found',
  IN_PROGRESS: 'in_progress',
  CONFIGURATION: 'configuration',
  UNKNOWN: 'unknown',
});

const toNumber = value => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
};

export const normalizeNativeAuthError = error => {
  if (!error || typeof error !== 'object') {
    return error;
  }
  const userInfo = error.userInfo || {};

  if (!error.nativeError && userInfo.nativeError) {
    error.nativeError = userInfo.nativeError;
  }
  if (!error.reason) {
    error.reason = userInfo.reason || ErrorReason.UNKNOWN;
  }
  if (error.httpStatus === undefined) {
    const httpStatus = toNumber(userInfo.httpStatus);
    if (httpStatus !== undefined) {
      error.httpStatus = httpStatus;
    }
  }
  if (!error.errorDescription && userInfo.errorDescription) {
    error.errorDescription = userInfo.errorDescription;
  }
  if (!error.errorUri && userInfo.errorUri) {
    error.errorUri = userInfo.errorUri;
  }
  return error;
};

export const wrapNativeAuthPromise = promise =>
  Promise.resolve(promise).catch(error => Promise.reject(normalizeNativeAuthError(error)));

export const getErrorReason = error =>
  (error && (error.reason || (error.userInfo && error.userInfo.reason))) || ErrorReason.UNKNOWN;

export const isNetworkError = error => getErrorReason(error) === ErrorReason.NETWORK_ERROR;

export const isUserCancelledError = error => {
  const reason = getErrorReason(error);
  return reason === ErrorReason.USER_CANCELLED || reason === ErrorReason.PROGRAM_CANCELLED;
};

export const createAppAuthError = (code, message, extras = {}) => {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extras);
  if (!error.reason) {
    error.reason = ErrorReason.UNKNOWN;
  }
  return error;
};
