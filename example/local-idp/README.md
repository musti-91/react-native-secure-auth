# Local test identity provider

A small OpenID Connect server ([`oidc-provider`](https://github.com/panva/node-oidc-provider)) for testing the
example app against a real authorization server on your machine. **Development only:** it uses plain HTTP and
in-memory storage, and accepts any username and password.

## Run it

```sh
cd example/local-idp
npm install
npm start                    # http://localhost:3000
```

Or, from `example/`: `yarn idp`.

**Android:** the emulator or device must reach your machine's `localhost`. Run this once per device connection:

```sh
adb reverse tcp:3000 tcp:3000    # or: yarn idp:android (from example/)
```

**iOS simulator:** works as is. `localhost` is your Mac, and the example's `Info.plist` allows local networking.

Then set `USE_LOCAL_IDP = true` in `example/App.tsx` (the default) and run the app.

## What it provides

|                         |                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Issuer / discovery      | `http://localhost:3000`, `/.well-known/openid-configuration`                        |
| Client `example-app`    | Secret `local-test-secret`, `client_secret_post`. Used by `example/localIdp.ts`.    |
| Client `example-public` | No secret (PKCE only).                                                              |
| Redirect URIs           | `com.rnappauthexample://login/callback`, `com.rnappauthexample://login`             |
| PKCE                    | Required (S256)                                                                     |
| Tokens                  | Access token 120 s (to test refresh), refresh token always issued, ID token         |
| Endpoints               | authorize, token, userinfo (`/me`), revocation, introspection, end session (logout) |

Settings, through environment variables:

| Variable           | Default                         |
| ------------------ | ------------------------------- |
| `PORT`             | `3000`                          |
| `ISSUER`           | `http://localhost:$PORT`        |
| `ACCESS_TOKEN_TTL` | `120` (seconds)                 |
| `REDIRECT_URIS`    | comma-separated list, see above |

## Login page

Any username works and becomes the `sub` claim (default `alice`; a `prefill` message with `loginHint`
from the app replaces it). **Cancel** returns `access_denied`. Consent is approved automatically.

The page also tests the app bridge in web view mode:

- It shows whether it's embedded, and the bridge name it found (e.g. `window.myapp`, platform `ios`).
- It sends `{ type: 'ready' }` to the app on load, and has buttons to send `ready` and `close`.
- It lists every message from the app (`initialMessages`, `postMessage()`, `deeplink` payloads).
- **Navigate to deep link** opens `<redirect scheme>://auth?code=…&state=…`. With
  `androidDeepLinkUrls: ['auth']` on Android, this is forwarded to the page as a `deeplink` message and
  stays in the web view.
- **Open a host outside webViewAllowedHosts** checks the hand-off to an app or the system browser.
- It shows the headers of the authorize request, to check `customHeaders.authorize` and `browser.userAgent`.

The server console logs every request, the login, and token or authorization errors.

## Test a deep link from outside (Android)

While the web view is open:

```sh
adb shell am start -a android.intent.action.VIEW -d "com.rnappauthexample://idapp/login?code=abc&state=xyz"
```

Only works for hosts that `example/android/app/src/main/AndroidManifest.xml` routes to
`RNAppAuthWebViewActivity` (`idapp`, `auth`).

## Notes

- The signing key is generated at startup, so tokens from an earlier run are invalid after a restart.
  Log in again.
- `dangerouslyAllowInsecureHttpRequests: true` in `localIdp.ts` is needed for plain HTTP. Never use it
  with a real identity provider.
