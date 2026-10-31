# Browser customization and messaging

Every `authorize()` and `logout()` call accepts a `browser` object. Most options are ignored by user agents that can't support them, so one config works on both platforms.

## Choosing a user agent

| `browser.iosMode`        | User agent                                          | Header customization                                                          | postMessage     |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------- | --------------- |
| `'system'` (default)     | `ASWebAuthenticationSession`, or `iosCustomBrowser` | None (the system controls it)                                                 | `'unsupported'` |
| `'safariViewController'` | `SFSafariViewController`                            | Bar and tint colors, dismiss button style, bar collapsing, presentation style | `'unsupported'` |
| `'webView'`              | Embedded `WKWebView`                                | Everything                                                                    | Two-way         |

| `browser.androidMode`   | User agent                           | Header customization                                                                                          | postMessage                            |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `'customTab'` (default) | Custom Tabs, or a partial Custom Tab | Colors (light and dark), title, close button icon and position, share, URL-bar hiding, menu items, animations | Two-way, but needs Digital Asset Links |
| `'webView'`             | Embedded `WebView` activity          | Everything                                                                                                    | Two-way                                |

> ⚠️ **Embedded web views.** [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252#section-8.12) discourages them. Some identity providers block them, including Google. The app can also read everything typed into an embedded web view, so use `'webView'` only with identity providers you control. Restrict it with `messaging.allowedOrigins` and `webViewAllowedHosts`.

## Header options (`browser.header`)

| Option                                            | Custom Tabs                 | SFSafariVC                      | Web view (iOS/Android)   |
| ------------------------------------------------- | --------------------------- | ------------------------------- | ------------------------ |
| `backgroundColor`                                 | ✅ toolbar                  | ✅ `preferredBarTintColor`      | ✅                       |
| `tintColor`                                       | –                           | ✅ `preferredControlTintColor`  | ✅                       |
| `titleColor`                                      | –                           | –                               | ✅                       |
| `secondaryColor`                                  | ✅ bottom toolbar           | –                               | –                        |
| `navigationBarColor`, `navigationBarDividerColor` | ✅                          | –                               | ✅ (Android)             |
| `progressColor`, `showProgress`                   | –                           | –                               | ✅                       |
| `dark: { …colors }`                               | ✅                          | ✅                              | ✅                       |
| `colorScheme: 'system' \| 'light' \| 'dark'`      | ✅                          | ✅                              | ✅                       |
| `title`                                           | –                           | –                               | ✅                       |
| `showTitle`                                       | ✅                          | –                               | ✅                       |
| `showUrl` (host under the title)                  | –                           | –                               | ✅                       |
| `hidden`                                          | –                           | –                               | ✅                       |
| `hideUrlBarOnScroll`                              | ✅                          | ✅ (bar collapsing)             | ✅ (iOS: hides on swipe) |
| `shareButton`                                     | ✅                          | –                               | –                        |
| `closeButton.position: 'start' \| 'end'`          | ✅                          | –                               | ✅                       |
| `closeButton.style`                               | `'close'`, `'back'`         | `'done'`, `'close'`, `'cancel'` | all                      |
| `closeButton.text`, `closeButton.hidden`          | –                           | –                               | ✅                       |
| `buttons: [{ id, title, position }]`              | ✅ (as overflow menu items) | –                               | ✅                       |

Pressing a custom header button emits a `headerButtonPress` event with `buttonId` set.

## Other options

| Option                                                                                          | Applies to                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `headers`                                                                                       | Web view: always. Custom Tabs: CORS-safelisted headers, or any header when Digital Asset Links verifies the origin. iOS `'system'`: iOS 17.4+.                                                                                      |
| `userAgent`                                                                                     | Web view                                                                                                                                                                                                                            |
| `iosPresentationStyle`, `iosModalInPresentation`                                                | SFSafariVC and web view                                                                                                                                                                                                             |
| `iosEntersReaderIfAvailable`                                                                    | SFSafariVC                                                                                                                                                                                                                          |
| `androidPartial: { height, width, breakpoint, cornerRadius, resizable, backgroundInteraction }` | Custom Tabs. Needs a browser that supports partial tabs (Chrome 107+); otherwise a full tab opens.                                                                                                                                  |
| `androidAnimation: 'default' \| 'slide' \| 'fade' \| 'none'`                                    | Custom Tabs and web view                                                                                                                                                                                                            |
| `clearWebViewData`                                                                              | Web view. Starts with empty cookies and storage.                                                                                                                                                                                    |
| `webViewAllowedHosts`                                                                           | Web view. Other hosts open in a native app that handles the link (Android 11+, and always on iOS, e.g. a bank or ID app), otherwise in the system browser. Don't list hosts that must hand off to an app. Supports `*.example.com`. |
| `androidDeepLinkUrls`                                                                           | Web view. Deep links forwarded to the page. Entries are `scheme://host/path` or `host/path` for any scheme (e.g. `'login'`); a trailing `*` matches any suffix. See [Deep links](#deep-links-while-the-web-view-is-open-android).   |
| `onMessage(message, event)`, `onEvent(event)`                                                   | Callbacks scoped to this flow. They're removed when the flow ends.                                                                                                                                                                  |

## Loader (web view modes)

Show your own React component over the embedded web view until the first page has loaded. Mount the provider once:

```jsx
import { AppAuthProvider } from 'react-native-secure-auth';

<AppAuthProvider loader={<MySpinner />} backgroundColor="#ffffff" fadeDuration={200}>
  <App />
</AppAuthProvider>;
```

`loader` is an element or a component. It's used by every `authorize()`/`logout()` call that has `iosMode: 'webView'` or `androidMode: 'webView'`. Per call, `browser.loader: false` disables it, and `browser.loader: { backgroundColor, fadeDuration }` overrides the provider.

- Custom Tabs, `SFSafariViewController` and `ASWebAuthenticationSession` are drawn by the system, so they can't show a loader.
- The loader renders in its own React surface. React context from your app tree isn't available inside it, so pass what it needs as props.
- It hides on the first `navigationFinished` or `navigationFailed`.
- iOS finds the React root view factory on the app delegate or the scene delegates, through `reactNativeFactory.rootViewFactory` or `rootViewFactory`. In Swift, mark the property `@objc` (for example `@objc var reactNativeFactory: RCTReactNativeFactory?`). Without a factory, a message is logged and no loader is shown.

## Messaging

Messages are strings or JSON-serializable values. JSON is serialized on the way out and parsed on the way in.

```js
import { postMessage, addMessageListener, addBrowserEventListener } from 'react-native-secure-auth';

await postMessage({ type: 'theme', value: 'dark' }); // returns 'queued': no browser is open yet

const sub = addMessageListener((msg, event) => console.log(event.origin, msg));

authorize({
  ...config,
  browser: {
    iosMode: 'webView',
    androidMode: 'webView',
    messaging: {
      initialMessages: [{ type: 'hello' }], // delivered first, on every page load
      allowedOrigins: ['https://login.example.com'],
    },
  },
});

// While the browser is open:
await postMessage({ type: 'prefill', email: 'bob@example.com' }); // 'delivered'
```

Delivery order when a channel becomes ready:

1. `messaging.initialMessages`
2. Everything that was queued with `postMessage()`

Each time a channel opens, a `messageChannelReady` event is emitted.

`allowedOrigins` entries are full origins (`'https://login.example.com'`), wildcards
(`'https://*.example.com'`), or `'*'`. On Android, an entry without a scheme (`'*.example.com'` or
`'login.example.com'`) matches that host on any http(s) origin.

To send only to a page that is open now, without queuing, pass `throwIfNotOpen`:

```js
try {
  await postMessage({ type: 'refresh' }, { throwIfNotOpen: true }); // 'delivered'
} catch (e) {
  // e.code === 'message_not_delivered'
  // e.result is 'notOpen' (no authorize/logout browser open, or its channel isn't ready) or 'unsupported'
}
```

With `throwIfNotOpen`, the message is never queued, and messages already in the queue are left alone.

### Deep links while the web view is open (Android)

When another app (e.g. an ID or banking app) returns with `myapp://login?code=…&state=…`, Android normally
sends it to your `singleTask` main activity, which destroys the web view. To keep the web view alive,
let it receive the link instead. Add this to your app's `AndroidManifest.xml` (and remove the same
filter from `MainActivity`, otherwise Android shows a chooser):

```xml
<activity
  android:name="com.rnappauth.browser.RNAppAuthWebViewActivity"
  android:exported="true"
  tools:node="merge"
  tools:replace="android:exported">
  <intent-filter>
    <action android:name="android.intent.action.VIEW"/>
    <category android:name="android.intent.category.DEFAULT"/>
    <category android:name="android.intent.category.BROWSABLE"/>
    <data android:scheme="myapp" android:host="login"/>
  </intent-filter>
</activity>
```

Set `browser.androidDeepLinkUrls: ['login']` to forward only `myapp://login` (any query string);
other links routed to the web view are ignored. When unset, every link is forwarded. A listed link that the page itself navigates to (e.g. `myapp://flow/back`) is forwarded to the page too and doesn't leave the web view.

The page then receives `{ "type": "deeplink", "url", "code", "state" }` (`error` and
`error_description` too when present), and a `deeplink` event is emitted. Requires messaging to be
enabled. Links that match the redirect URI still complete the flow.

> ⚠️ A link routed to `RNAppAuthWebViewActivity` while **no** web view is open does not open your
> app. A `deeplink` event with `result: 'notOpen'` is emitted (only if the JS runtime is running) and
> the activity closes. Route only links that are used during a web view flow, and keep your other
> deep links on `MainActivity`.

### Page-side code (web view mode)

```js
function onNative(event) {
  const msg = JSON.parse(event.data); // event.origin === 'react-native'
  if (msg.type === 'prefill') document.querySelector('#email').value = msg.email;
}
window.addEventListener('message', onNative);

function send(msg) {
  window.RNAppAuth.postMessage(JSON.stringify(msg)); // window.ReactNativeWebView.postMessage works too
}
if (window.RNAppAuth) send({ type: 'ready' });
else window.addEventListener('rnappauthready', () => send({ type: 'ready' }));
```

`window.RNAppAuth.isEmbedded` and `window.RNAppAuth.platform` let the page detect the app.

To use another name, set `browser.messaging.bridgeName`. With `bridgeName: 'myapp'` the page uses
`window.myapp.postMessage(...)`, `window.myapp.onmessage`, and listens for the `myappready` event
(the lowercased name plus `ready`). It must be a valid JavaScript identifier. `window.ReactNativeWebView`
is still provided.

### Android Custom Tabs

Custom Tabs postMessage uses the browser's `requestPostMessageChannel`. The browser only opens the channel when your app is verified for `messaging.androidOrigin` through [Digital Asset Links](https://developer.android.com/develop/ui/views/layout/webapps/digital-asset-links), using the `delegate_permission/common.use_as_origin` relation:

```json
[
  {
    "relation": ["delegate_permission/common.use_as_origin"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.example.app",
      "sha256_cert_fingerprints": ["…"]
    }
  }
]
```

```js
browser: {
  messaging: {
    androidOrigin: 'https://login.example.com';
  }
}
```

The page receives the app's messages as `message` events on `window`. It replies through the port attached to the first message: `event.ports[0].postMessage(...)`. If verification fails, a `messageChannelFailed` event is emitted and messages stay queued.

### iOS system and Safari modes

Apple doesn't let apps message pages loaded in `ASWebAuthenticationSession` or `SFSafariViewController`. While one of these is open, `postMessage()` returns `'unsupported'`, and queued messages are kept for the next web view flow. To send data to the server in these modes, use `additionalParameters`, or `browser.headers` on iOS 17.4+.

## Events

`addBrowserEventListener(event => …)` receives these `type` values:

| Event                                                         | Emitted                                                                                                                                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opened`, `closed`                                            | Every mode                                                                                                                                                     |
| `navigationStarted`, `navigationFinished`, `navigationFailed` | Custom Tabs, SFSafariVC, web view                                                                                                                              |
| `navigationAborted`, `tabShown`, `tabHidden`                  | Custom Tabs                                                                                                                                                    |
| `messageChannelReady`, `messageChannelFailed`, `message`      | Modes that support messaging                                                                                                                                   |
| `deeplink`                                                    | Android web view. A deep link was routed to the web view. `event.result` is `'delivered'`, `'queued'`, `'unsupported'`, or `'notOpen'` (no web view was open). |
| `headerButtonPress`                                           | Custom Tabs (menu items) and web view                                                                                                                          |

`event.mode` is one of `'customTab'`, `'webView'`, `'system'`, or `'safariViewController'`.
