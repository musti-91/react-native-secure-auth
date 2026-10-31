# Changelog

## 1.2.0 (unreleased)

### ⚠️ Behavior changes (check before upgrading)

None of these change the public API. They do change runtime behavior that existing apps may rely on.

- **Android web view: links to hosts not in `webViewAllowedHosts` can now open a native app.** Before,
  they always opened in the system browser. On Android 11+ an installed app that handles the link now
  opens first. If your flow expects the browser, add the host to `webViewAllowedHosts`. See Fixes below.
- **`messaging.allowedOrigins` (Android): rules without a scheme now match.** `'*.example.com'` and
  `'example.com'` used to match nothing on Android. Now they match any http(s) origin on that host.
  If you relied on the old behavior, the bridge now accepts more origins than before. Use full
  origins such as `'https://login.example.com'` to keep the list strict.
- **`postMessage()` always returns a promise.** An invalid message (for example `undefined`) used to
  throw synchronously. Now the returned promise rejects. Code that wraps `postMessage()` in
  `try/catch` without `await` no longer catches the error.
- **Deep link intent filter on `RNAppAuthWebViewActivity` (opt-in).** If you move a deep link filter
  from `MainActivity` to the web view activity, a link that arrives while no web view is open does
  **not** open your app. It emits a `deeplink` event with `result: 'notOpen'` and the activity closes.
  Only route links there that make sense during a web view flow.

### Features

- **Android web view: forward deep links to the page.** A deep link routed to the open web view is
  posted to the page as `{type:'deeplink', url, code, state}` and emits a `deeplink` event. Limit which links are forwarded with
  `browser.androidDeepLinkUrls`. Custom-scheme links that the page itself navigates to and that
  match `androidDeepLinkUrls` are forwarded too, and stay in the web view. See `docs/browser.md`.
- **Custom bridge name: `browser.messaging.bridgeName`** (iOS and Android web view). Exposes
  `window.<bridgeName>` and a `<bridgename>ready` event instead of `window.RNAppAuth` /
  `rnappauthready`. The default stays `RNAppAuth`. The name must be a valid JavaScript identifier.
- **`postMessage(message, { throwIfNotOpen: true })`** delivers only to an authorize/logout browser
  that is open now. Otherwise it rejects with `code: 'message_not_delivered'` and
  `result: 'notOpen' | 'unsupported'`. The message is never queued, and messages already in the queue
  are left untouched. Without the option, the behavior is the same as before.
- **`BrowserEvent.result`** and the `deeplink` event type are added to the TypeScript types.

### Fixes

- **Android web view: open native apps for app links.** When `androidMode: 'webView'` navigates to an
  http(s) host that isn't in `webViewAllowedHosts`, the web view now first tries to open an installed
  app that handles the link (`FLAG_ACTIVITY_REQUIRE_NON_BROWSER`, Android 11+), as Custom Tabs do. This
  makes flows such as login with an ID or banking app open that app instead of a second browser. If no app
  handles the link, it still opens in the system browser. iOS already behaves this way (`openURL`), so
  no iOS change was needed. Hosts listed in `webViewAllowedHosts` keep
  loading inside the web view, so don't list hosts that must hand off to an app (e.g. `*.id-provider.example`).

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
{
  "plugins": [["react-native-secure-auth", { "redirectUrls": ["com.example.app:/oauthredirect"] }]]
}
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
