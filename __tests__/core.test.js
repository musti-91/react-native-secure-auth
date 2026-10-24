import { DeviceEventEmitter } from 'react-native';
import { setPlatform, resetNativeModule } from '../jest/nativeMock';
import {
  authorize,
  refresh,
  logout,
  prefetchConfiguration,
  resumePendingAuthorize,
  revoke,
  setCachedServiceConfiguration,
  clearServiceConfigurationCache,
  ErrorReason,
} from '../src';

const config = {
  issuer: 'https://example.com',
  clientId: 'client',
  redirectUrl: 'com.example:/oauth',
  scopes: ['openid'],
};

describe('native argument marshalling', () => {
  let native;
  beforeEach(() => {
    native = resetNativeModule();
    clearServiceConfigurationCache();
  });

  it('passes the iOS authorize arguments in native order, with browser options last', async () => {
    setPlatform('ios');
    await authorize({
      ...config,
      additionalHeaders: { X: '1' },
      iosCustomBrowser: 'edge',
      iosPrefersEphemeralSession: true,
      clientAuthMethod: 'post',
      browser: { iosMode: 'webView', header: { title: 'Sign in' } },
    });
    expect(native.authorize).toHaveBeenCalledWith(
      config.issuer,
      config.redirectUrl,
      'client',
      undefined,
      ['openid'],
      undefined,
      null,
      false,
      60,
      { X: '1' },
      true,
      true,
      'edge',
      true,
      'post',
      { mode: 'webView', header: { title: 'Sign in' } }
    );
  });

  it('passes the Android authorize arguments in native order, timeout in ms', async () => {
    setPlatform('android');
    await authorize({ ...config, connectionTimeoutSeconds: 5, androidTrustedWebActivity: true });
    const args = native.authorize.mock.calls[0];
    expect(args).toHaveLength(18);
    expect(args[8]).toBe(5000);
    expect(args[15]).toBe(true);
    expect(args[17]).toBeNull();
  });

  it('merges responseMode into additionalParameters', async () => {
    setPlatform('ios');
    await authorize({ ...config, responseMode: 'form_post', additionalParameters: { a: 'b' } });
    expect(native.authorize.mock.calls[0][5]).toEqual({ a: 'b', response_mode: 'form_post' });
  });

  it('uses a cached discovery configuration instead of the issuer', async () => {
    setPlatform('ios');
    const cached = { authorizationEndpoint: 'https://a', tokenEndpoint: 'https://t' };
    setCachedServiceConfiguration('https://example.com/', cached);
    await authorize(config);
    expect(native.authorize.mock.calls[0][6]).toBe(cached);
  });

  it('passes clientAuthMethod to the iOS refresh', async () => {
    setPlatform('ios');
    await refresh({ ...config, clientAuthMethod: 'post' }, { refreshToken: 'r' });
    const args = native.refresh.mock.calls[0];
    expect(args[4]).toBe('r');
    expect(args[args.length - 1]).toBe('post');
  });

  it('passes browser options to logout on both platforms', async () => {
    const browser = { header: { showTitle: false } };
    setPlatform('ios');
    await logout(config, { idToken: 'id', postLogoutRedirectUrl: 'com.example:/out' });
    expect(native.logout.mock.calls[0]).toHaveLength(8);
    expect(native.logout.mock.calls[0][7]).toBeNull();
    setPlatform('android');
    await logout({ ...config, browser }, { idToken: 'id', postLogoutRedirectUrl: 'com.example:/out' });
    expect(native.logout.mock.calls[1][8]).toEqual({ mode: 'customTab', header: { showTitle: false } });
  });

  it('only prefetches / resumes on Android', async () => {
    setPlatform('ios');
    await prefetchConfiguration(config);
    expect(await resumePendingAuthorize()).toBeNull();
    expect(native.prefetchConfiguration).not.toHaveBeenCalled();
    expect(native.resumePendingAuthorize).not.toHaveBeenCalled();
  });

  it('validates the config before calling native', () => {
    setPlatform('ios');
    expect(() => authorize({ ...config, clientId: undefined })).toThrow();
    expect(() => authorize({ ...config, iosCustomBrowser: 'netscape' })).toThrow(/iosCustomBrowser/);
    expect(() => authorize({ ...config, browser: { iosMode: 'nope' } })).toThrow(/iosMode/);
    expect(native.authorize).not.toHaveBeenCalled();
  });

  it('normalizes native rejections with a reason', async () => {
    setPlatform('ios');
    native.authorize.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('cancelled'), {
          code: 'authentication_failed',
          userInfo: { reason: 'user_cancelled', nativeError: 'x', httpStatus: '400' },
        })
      )
    );
    await expect(authorize(config)).rejects.toMatchObject({
      reason: ErrorReason.USER_CANCELLED,
      nativeError: 'x',
      httpStatus: 400,
    });
  });

  it('subscribes browser callbacks only for the duration of the call', async () => {
    setPlatform('ios');
    let finish;
    native.authorize.mockImplementation(() => new Promise(resolve => (finish = resolve)));
    const onMessage = jest.fn();
    const onEvent = jest.fn();
    const promise = authorize({ ...config, browser: { onMessage, onEvent } });

    DeviceEventEmitter.emit('RNAppAuthBrowserEvent', { type: 'message', data: '{"a":1}' });
    expect(onMessage).toHaveBeenCalledWith({ a: 1 }, expect.objectContaining({ type: 'message' }));
    expect(onEvent).toHaveBeenCalledTimes(1);

    finish({});
    await promise;
    DeviceEventEmitter.emit('RNAppAuthBrowserEvent', { type: 'message', data: 'late' });
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});

describe('revoke', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
  });

  it('posts the token form-encoded with optional client id and basic auth', async () => {
    await revoke(
      {
        clientId: 'client',
        clientSecret: 'secret',
        serviceConfiguration: {
          authorizationEndpoint: 'https://a',
          tokenEndpoint: 'https://t',
          revocationEndpoint: 'https://r',
        },
      },
      { tokenToRevoke: 'a b', sendClientId: true, includeBasicAuth: true, tokenTypeHint: 'refresh_token' }
    );
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://r');
    expect(init.body).toBe('token=a+b&client_id=client&token_type_hint=refresh_token');
    expect(init.headers.Authorization).toBe('Basic Y2xpZW50OnNlY3JldA==');
  });

  it('rejects with a network reason when the request fails', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    await expect(
      revoke({ clientId: 'c', serviceConfiguration: { revocationEndpoint: 'https://r' } }, { tokenToRevoke: 't' })
    ).rejects.toMatchObject({ reason: ErrorReason.NETWORK_ERROR });
  });
});
