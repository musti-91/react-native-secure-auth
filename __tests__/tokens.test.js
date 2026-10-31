import '../jest/nativeMock';
import { decodeJwt, isTokenExpired, createTokenRefresher } from '../src/tokens';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('decodeJwt', () => {
  it('decodes header and payload', () => {
    const token = `${b64({ alg: 'RS256' })}.${b64({ sub: 'ü-user' })}.sig`;
    expect(decodeJwt(token)).toEqual({
      header: { alg: 'RS256' },
      payload: { sub: 'ü-user' },
      signature: 'sig',
    });
  });

  it('throws on malformed tokens', () => {
    expect(() => decodeJwt('abc')).toThrow(/not a JWT/);
    expect(() => decodeJwt('abc.def')).toThrow(/invalid JWT/);
  });
});

describe('isTokenExpired', () => {
  const now = Date.parse('2024-01-01T00:00:00Z');
  it('honours the leeway and treats unknown dates as expired', () => {
    expect(isTokenExpired('2024-01-01T00:05:00Z', 0, now)).toBe(false);
    expect(isTokenExpired('2024-01-01T00:05:00Z', 600, now)).toBe(true);
    expect(isTokenExpired('', 0, now)).toBe(true);
  });
});

describe('createTokenRefresher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse('2024-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  const tokens = { refreshToken: 'r1', accessTokenExpirationDate: '2024-01-01T00:10:00Z' };

  it('refreshes before expiry and keeps the old refresh token when none is returned', async () => {
    const refresh = jest.fn(() =>
      Promise.resolve({ accessToken: 'a2', accessTokenExpirationDate: '2024-01-01T01:00:00Z' })
    );
    const onRefresh = jest.fn();
    const refresher = createTokenRefresher({}, tokens, { refresh, onRefresh, leewaySeconds: 60 });
    refresher.start();

    jest.advanceTimersByTime(8 * 60 * 1000);
    expect(refresh).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(refresh).toHaveBeenCalledWith({}, { refreshToken: 'r1' });
    expect(onRefresh.mock.calls[0][1].refreshToken).toBe('r1');
    refresher.stop();
  });

  it('retries network errors and gives up on other errors', async () => {
    const networkError = Object.assign(new Error('offline'), { reason: 'network_error' });
    const fatal = Object.assign(new Error('bad'), { reason: 'oauth_error' });
    const refresh = jest.fn().mockRejectedValueOnce(networkError).mockRejectedValueOnce(fatal);
    const onError = jest.fn();
    const refresher = createTokenRefresher(
      {},
      { refreshToken: 'r' },
      { refresh, onError, retryDelaySeconds: 5 }
    );
    refresher.start();

    await jest.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(fatal);
  });
});
