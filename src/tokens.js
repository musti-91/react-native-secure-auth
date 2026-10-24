import { base64UrlDecode, invariant } from './utils';
import { isNetworkError } from './errors';
import { refresh as defaultRefresh } from './core';

const MAX_TIMEOUT_MS = 2147483647;

/**
 * Decodes (without verifying!) a JWT such as an ID token.
 */
export const decodeJwt = token => {
  invariant(typeof token === 'string', 'decodeJwt: token must be a string');
  const parts = token.split('.');
  invariant(parts.length >= 2, 'decodeJwt: token is not a JWT');
  const parse = (part, name) => {
    try {
      return JSON.parse(base64UrlDecode(part));
    } catch (e) {
      throw new Error(`decodeJwt: invalid JWT ${name}`);
    }
  };
  return { header: parse(parts[0], 'header'), payload: parse(parts[1], 'payload'), signature: parts[2] || '' };
};

const toTime = date => {
  if (date === undefined || date === null || date === '') {
    return NaN;
  }
  if (date instanceof Date) {
    return date.getTime();
  }
  if (typeof date === 'number') {
    return date;
  }
  return new Date(date).getTime();
};

/**
 * True when the expiration date is in the past, or within `leewaySeconds` from now.
 * Unknown / unparseable dates are considered expired.
 */
export const isTokenExpired = (expirationDate, leewaySeconds = 0, now = Date.now()) => {
  const time = toTime(expirationDate);
  if (Number.isNaN(time)) {
    return true;
  }
  return time - leewaySeconds * 1000 <= now;
};

/**
 * Keeps an access token fresh by refreshing it shortly before it expires.
 *
 *   const refresher = createTokenRefresher(config, tokens, {
 *     onRefresh: result => save(result),
 *     onError: error => logout(),
 *   });
 *   refresher.start();
 */
export const createTokenRefresher = (config, tokens, options = {}) => {
  invariant(config, 'createTokenRefresher: config is required');
  invariant(tokens && tokens.refreshToken, 'createTokenRefresher: tokens.refreshToken is required');
  const {
    leewaySeconds = 60,
    retryDelaySeconds = 30,
    maxNetworkRetries = Infinity,
    onRefresh,
    onError,
    refresh = defaultRefresh,
  } = options;

  let state = {
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpirationDate: tokens.accessTokenExpirationDate,
    idToken: tokens.idToken,
  };
  let timer = null;
  let running = false;
  let inFlight = null;
  let networkRetries = 0;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = delayMs => {
    clearTimer();
    if (!running) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      refreshNow().catch(() => {});
    }, Math.max(0, Math.min(delayMs, MAX_TIMEOUT_MS)));
  };

  const scheduleFromExpiration = () => {
    const time = toTime(state.accessTokenExpirationDate);
    if (Number.isNaN(time)) {
      schedule(0);
      return;
    }
    schedule(time - leewaySeconds * 1000 - Date.now());
  };

  const refreshNow = () => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = Promise.resolve()
      .then(() => refresh(config, { refreshToken: state.refreshToken }))
      .then(
        result => {
          inFlight = null;
          networkRetries = 0;
          state = {
            ...state,
            ...result,
            // Providers without refresh token rotation do not return a new one.
            refreshToken: result.refreshToken || state.refreshToken,
          };
          if (onRefresh) {
            onRefresh(result, { ...state });
          }
          scheduleFromExpiration();
          return result;
        },
        error => {
          inFlight = null;
          if (running && isNetworkError(error) && networkRetries < maxNetworkRetries) {
            networkRetries += 1;
            schedule(retryDelaySeconds * 1000);
          } else {
            clearTimer();
            running = false;
            if (onError) {
              onError(error);
            }
          }
          throw error;
        }
      );
    return inFlight;
  };

  return {
    start() {
      running = true;
      scheduleFromExpiration();
      return this;
    },
    stop() {
      running = false;
      clearTimer();
    },
    refreshNow,
    /** Refreshes only when the current access token is (about to be) expired. */
    async getValidAccessToken() {
      if (isTokenExpired(state.accessTokenExpirationDate, leewaySeconds) || !state.accessToken) {
        await refreshNow();
      }
      return state.accessToken;
    },
    getTokens: () => ({ ...state }),
    isRunning: () => running,
  };
};
