import '../jest/nativeMock';
import {
  fetchServiceConfiguration,
  clearServiceConfigurationCache,
  fetchUserInfo,
  serviceConfigurationFromDiscoveryDocument,
} from '../src/discovery';

const document = {
  issuer: 'https://example.com',
  authorization_endpoint: 'https://example.com/authorize',
  token_endpoint: 'https://example.com/token',
  userinfo_endpoint: 'https://example.com/userinfo',
  end_session_endpoint: 'https://example.com/logout',
};

const jsonResponse = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });

describe('discovery', () => {
  beforeEach(() => {
    clearServiceConfigurationCache();
    global.fetch = jest.fn(() => jsonResponse(document));
  });

  it('maps the discovery document to a service configuration', () => {
    expect(serviceConfigurationFromDiscoveryDocument(document)).toMatchObject({
      authorizationEndpoint: document.authorization_endpoint,
      tokenEndpoint: document.token_endpoint,
      userInfoEndpoint: document.userinfo_endpoint,
      endSessionEndpoint: document.end_session_endpoint,
      issuer: document.issuer,
      discoveryDocument: document,
    });
  });

  it('fetches once and caches per issuer', async () => {
    await fetchServiceConfiguration({ issuer: 'https://example.com/' });
    await fetchServiceConfiguration({ issuer: 'https://example.com' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://example.com/.well-known/openid-configuration');
  });

  it('rejects documents without the required endpoints', async () => {
    global.fetch = jest.fn(() => jsonResponse({ issuer: 'x' }));
    await expect(fetchServiceConfiguration({ issuer: 'https://example.com' })).rejects.toMatchObject({
      reason: 'invalid_response',
    });
  });

  it('calls userinfo with the access token', async () => {
    global.fetch = jest.fn(() => jsonResponse({ sub: '1' }));
    const info = await fetchUserInfo(
      { serviceConfiguration: { userInfoEndpoint: 'https://example.com/userinfo' } },
      { accessToken: 'tok' }
    );
    expect(info).toEqual({ sub: '1' });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
});
