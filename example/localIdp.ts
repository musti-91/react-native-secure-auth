import type { AuthConfiguration } from 'react-native-secure-auth';

/**
 * Config for the local test identity provider in `example/local-idp` (development only).
 * Start it with `cd example/local-idp && npm install && npm start`.
 * On Android, also run `adb reverse tcp:3000 tcp:3000` so the device reaches localhost.
 */
export const LOCAL_IDP_URL = 'http://localhost:3000';

export const localIdpConfig: AuthConfiguration = {
  issuer: LOCAL_IDP_URL,
  clientId: 'example-app',
  clientSecret: 'local-test-secret', // dummy secret of the local server, not a real one
  clientAuthMethod: 'post',
  redirectUrl: 'com.rnappauthexample://login/callback',
  scopes: ['openid', 'profile', 'email'],
  usePKCE: true,
  // The local server uses plain HTTP. Never set this for a real identity provider.
  dangerouslyAllowInsecureHttpRequests: true,
};
