# react-native-secure-auth

A React Native bridge for [AppAuth-iOS](https://github.com/openid/AppAuth-iOS) and
[AppAuth-Android](https://github.com/openid/AppAuth-Android) that supports OAuth 2.0 and OpenID Connect.

It provides:

- **Header customization** for Android Custom Tabs, iOS `SFSafariViewController`, and an optional embedded web view, all configured from JS.
- **postMessage messaging** with the open browser. You can queue messages before the browser opens, send them while it's open, and receive messages from the page.
- **Extra features** such as discovery caching, automatic token refresh and richer errors (see [Features](#features)).

> This package has no runtime JS dependencies.

## Installation

```sh
npm install react-native-secure-auth
# or
yarn add react-native-secure-auth
cd ios && pod install
```

### iOS setup

1. Register the redirect scheme under `CFBundleURLTypes` in `Info.plist`.
2. Make `AppDelegate` conform to `RNAppAuthAuthorizationFlowManager`. In a Swift project, add this import to the bridging header:
   ```objc
   #import <react-native-secure-auth/RNAppAuthAuthorizationFlowManager.h>
   ```
   Then update `AppDelegate`:
   ```swift
   class AppDelegate: UIResponder, UIApplicationDelegate, RNAppAuthAuthorizationFlowManager {
     weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?

     func application(_ app: UIApplication, open url: URL,
                      options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
       if authorizationFlowManagerDelegate?.resumeExternalUserAgentFlow(with: url) == true { return true }
       return RCTLinkingManager.application(app, open: url, options: options)
     }
   }
   ```
3. Apps that use **scenes** (the RN 0.88+ template) receive URLs in the `SceneDelegate`, so you need to forward them yourself. See
   [`example/ios/RNAppAuthExample/SceneDelegate.swift`](example/ios/RNAppAuthExample/SceneDelegate.swift).
4. To use `iosCustomBrowser`, add the browser schemes to `LSApplicationQueriesSchemes`: `googlechrome`, `opera-http`, `firefox`, `microsoft-edge-https`, …

### Android setup

1. Add the redirect scheme placeholder in `android/app/build.gradle`:
   ```groovy
   defaultConfig {
     manifestPlaceholders = [appAuthRedirectScheme: 'com.example.app']
   }
   ```
2. *(Recommended)* Forward authorization results from `MainActivity`. Then `resumePendingAuthorize()` can finish a login after Android re-creates the activity:
   ```kotlin
   override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
     if (requestCode == RNAppAuthModule.AUTHORIZATION_REQUEST_CODE) RNAppAuthModule.stashAuthorizationResult(data)
     super.onActivityResult(requestCode, resultCode, data)
   }
   ```

### Expo

```json
{
  "plugins": [
    ["react-native-secure-auth", {
      "redirectUrls": ["com.example.app:/oauthredirect"],
      "ios": { "customBrowserQuerySchemes": true },
      "android": { "patchMainActivity": true }
    }]
  ]
}
```

The plugin makes these changes:
- Registers the URL scheme.
- Patches the Swift `AppDelegate`, or the legacy Objective-C one.
- Creates or updates the bridging header.
- Sets `appAuthRedirectScheme`.
- Adds result forwarding to `MainActivity`.

## Usage

```js
import { authorize, refresh, logout, revoke, postMessage } from 'react-native-secure-auth';

const config = {
  issuer: 'https://demo.duendesoftware.com',
  clientId: 'interactive.public',
  redirectUrl: 'io.identityserver.demo:/oauthredirect',
  scopes: ['openid', 'profile', 'offline_access'],
};

const result = await authorize({
  ...config,
  browser: {
    header: { backgroundColor: '#1E3A8A', tintColor: '#fff', showTitle: true },
  },
});
const refreshed = await refresh(config, { refreshToken: result.refreshToken });
await logout(config, { idToken: result.idToken, postLogoutRedirectUrl: config.redirectUrl });
```

## API

### Core methods

The core methods are `authorize`, `refresh`, `revoke`, `logout`, `register`, and `prefetchConfiguration`. They take these config options:
- `issuer` / `serviceConfiguration`, `clientId`, `clientSecret`, `scopes`, `redirectUrl`
- `additionalParameters`, `additionalHeaders`, `customHeaders`
- `useNonce`, `usePKCE`, `skipCodeExchange`, `connectionTimeoutSeconds`, `dangerouslyAllowInsecureHttpRequests`
- `iosCustomBrowser`, `iosPrefersEphemeralSession`, `androidAllowCustomBrowsers`, `androidPrefersEphemeralSession`, `androidTrustedWebActivity`, `warmAndPrefetchChrome`

### New config options

| Option | Platforms | Description |
| --- | --- | --- |
| `browser` | both | Header, messaging, and presentation options. See [docs/browser.md](docs/browser.md). |
| `responseMode` | both | Sets the `response_mode` parameter (`query`, `fragment`, `form_post`, …). |
| `clientAuthMethod` | both | `'basic'` (default) or `'post'`, which sends the client secret in the token request body. iOS now supports `'post'` too. |
| `iosCustomBrowser: 'edge'` | iOS | Opens Microsoft Edge. |

### New functions

| Function | Description |
| --- | --- |
| `postMessage(message)` | Sends a string or JSON value to the page. Returns `'delivered'`, `'queued'` (no channel yet; it's delivered when the channel opens), or `'unsupported'`. |
| `clearPendingMessages()` | Drops queued messages. |
| `addMessageListener(fn)` | Receives messages that the page posts. JSON payloads are parsed. |
| `addBrowserEventListener(fn)` | Browser lifecycle events: `opened`, `closed`, navigation events, `messageChannelReady`, `message`, `headerButtonPress`, … |
| `dismissBrowser()` | Closes the authorization or logout browser from code. The pending promise rejects with reason `program_cancelled`. |
| `clearWebViewData()` | Clears cookies and storage for the embedded web view mode. |
| `resumePendingAuthorize(opts)` | Android only. Completes an authorization whose result was stashed after the activity was re-created. |
| `fetchServiceConfiguration({ issuer })` | Runs discovery explicitly. The result is cached and reused by `authorize`, `refresh`, and `logout`. |
| `getCachedServiceConfiguration`, `setCachedServiceConfiguration`, `clearServiceConfigurationCache`, `serviceConfigurationFromDiscoveryDocument` | Discovery cache helpers. |
| `fetchUserInfo(config, { accessToken })` | Calls the `userinfo` endpoint. |
| `decodeJwt(token)` / `isTokenExpired(date, leeway)` | Token helpers. `decodeJwt` doesn't verify the signature. |
| `createTokenRefresher(config, tokens, opts)` | Refreshes tokens automatically before they expire, and retries after network errors. |
| `getErrorReason`, `isNetworkError`, `isUserCancelledError`, `ErrorReason` | Error helpers that work the same on both platforms. |

### Errors

Rejections carry a `code` value (`authentication_failed`, `token_refresh_failed`, …). They also add these fields:

- `reason`: one of `user_cancelled`, `program_cancelled`, `network_error`, `server_error`, `oauth_error`, `invalid_response`, `id_token_validation`, `browser_not_found`, `in_progress`, `configuration`, `unknown`
- `httpStatus`
- `errorDescription`
- `errorUri`

## Browser customization and messaging

See **[docs/browser.md](docs/browser.md)** for the full option reference, a support matrix for each platform, and page-side snippets.

```js
await postMessage({ type: 'prefill', email }); // queued before the browser opens
const result = await authorize({
  ...config,
  browser: {
    iosMode: 'webView',
    androidMode: 'webView',
    header: {
      title: 'Sign in',
      backgroundColor: '#111827',
      tintColor: '#fff',
      closeButton: { position: 'start', style: 'back' },
      buttons: [{ id: 'help', title: 'Help' }],
    },
    messaging: { allowedOrigins: ['https://login.example.com'] },
    onMessage: msg => console.log('page says', msg),
    onEvent: e => e.type === 'headerButtonPress' && postMessage({ type: 'help' }),
  },
});
```

## Features

| Capability | API |
| --- | --- |
| Customisable in-app browser | `browser.header`, `browser.iosMode`, `browser.androidMode` |
| Partial Custom Tabs | `browser.androidPartial` |
| Expose and keep discovered config | `fetchServiceConfiguration` and the discovery cache |
| Response mode | `responseMode` |
| Dismiss the browser from code | `dismissBrowser()` |
| HTTP status and network errors | `error.httpStatus`, `error.reason`, `isNetworkError()` |
| Clear browser data | `clearWebViewData()`, `browser.clearWebViewData`, ephemeral sessions |
| User-Agent and headers on the authorize page | `browser.userAgent`, `browser.headers` |
| Automatic renewal | `createTokenRefresher()` |
| Decode `id_token` | `decodeJwt()` |
| Client secret via POST on iOS | `clientAuthMethod: 'post'` |
| No `AuthorizationService` leaks | The Android module disposes of every service it creates. |
| Edge on iOS | `iosCustomBrowser: 'edge'` |
| Safe boolean bridging | All booleans are coerced in JS before they reach the bridge. |

## Example app

`example/` is a React Native 0.88 app that runs against the Duende demo server. It shows every browser mode, messaging, dismissal, and token refresh.

```sh
cd example && yarn install && (cd ios && pod install) && yarn ios   # or: yarn android
```

## Development

```sh
yarn test              # JS unit tests
yarn test:plugin    # Expo plugin tests
yarn typecheck
yarn build:plugin
```

## License

MIT.
