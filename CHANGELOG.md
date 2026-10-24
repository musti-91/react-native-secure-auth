# Changelog

## 1.0.0 (2026-10-24)

First public release of `react-native-secure-auth`. It's a React Native bridge for
[AppAuth-iOS](https://github.com/openid/AppAuth-iOS) and
[AppAuth-Android](https://github.com/openid/AppAuth-Android) that supports OAuth 2.0 and OpenID Connect.
It has no runtime JS dependencies.

### Highlights

- **Customizable browser.** You can set the header (title, colors, buttons), presentation mode and
  User-Agent from JS. This works with Android Custom Tabs (full screen or partial), iOS
  `SFSafariViewController`, and an optional embedded web view (`iosMode` / `androidMode: 'webView'`).
- **postMessage messaging.** You can queue messages before the browser opens, send them while it's open,
  and receive messages from the page. The `browser.messaging.allowedOrigins` option restricts which
  origins are accepted.
- **Discovery caching.** `fetchServiceConfiguration` runs discovery once, and `authorize`, `refresh` and
  `logout` reuse the cached result.
- **Automatic token refresh.** `createTokenRefresher()` refreshes tokens before they expire and retries
  after network errors.
- **Consistent errors.** Every rejection has the same `reason`, `httpStatus`, `errorDescription` and
  `errorUri` fields on both platforms.

### API

**Core:** `authorize`, `refresh`, `revoke`, `logout`, `register`, `prefetchConfiguration`

**Browser and messaging:** `postMessage`, `clearPendingMessages`, `addMessageListener`,
`addBrowserEventListener`, `dismissBrowser`, `clearWebViewData`, `AppAuthProvider`

**Discovery:** `fetchServiceConfiguration`, `getCachedServiceConfiguration`, `setCachedServiceConfiguration`,
`clearServiceConfigurationCache`, `serviceConfigurationFromDiscoveryDocument`

**Tokens:** `fetchUserInfo`, `decodeJwt` (doesn't verify the signature), `isTokenExpired`, `createTokenRefresher`

**Errors:** `getErrorReason`, `isNetworkError`, `isUserCancelledError`, `ErrorReason`

**Android only:** `resumePendingAuthorize`, which completes a login after Android re-creates the activity

### Config options

- `browser`: header, messaging and presentation options. See [docs/browser.md](docs/browser.md).
- `responseMode`: sets `response_mode` (`query`, `fragment`, `form_post`, …).
- `clientAuthMethod`: `'basic'` (default) or `'post'`. Both work on iOS and Android.
- `iosCustomBrowser: 'edge'`: opens Microsoft Edge on iOS.
- `iosPrefersEphemeralSession` / `androidPrefersEphemeralSession`: sign in without sharing browser cookies.

### Platform behavior

- The Android module disposes of every `AuthorizationService` it creates, so services don't leak.
- Booleans are coerced in JS before they cross the bridge, which prevents native `BOOL` conversion errors.
- iOS supports apps that use scenes (the React Native 0.88+ template).

### Expo

An Expo config plugin is included. It registers the redirect scheme, patches `AppDelegate` (Swift or
Objective-C), creates or updates the bridging header, sets `appAuthRedirectScheme`, and can add
result forwarding to `MainActivity`.

```json
{ "plugins": [["react-native-secure-auth", { "redirectUrls": ["com.example.app:/oauthredirect"] }]] }
```

### Requirements

- React Native ≥ 0.76, React ≥ 18
- iOS 15.1+ (AppAuth ≥ 1.7.6)
- Android minSdk 24, compileSdk 36 (AppAuth-Android 0.11.1)

### Security notes

- PKCE is on by default. `dangerouslyAllowInsecureHttpRequests` turns off TLS verification on Android, so
  only use it in development.
- `decodeJwt` only decodes the token. Verify ID tokens on your server.

### Installation

```sh
npm install react-native-secure-auth
cd ios && pod install
```

See the [README](README.md) for iOS, Android and Expo setup.
