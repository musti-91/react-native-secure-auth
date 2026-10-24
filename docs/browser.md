# Browser customization and messaging

Every `authorize()` and `logout()` call accepts a `browser` object. Most options are ignored by user agents that can't support them, so one config works on both platforms.

## Choosing a user agent

| `browser.iosMode` | User agent | Header customization | postMessage |
| --- | --- | --- | --- |
| `'system'` (default) | `ASWebAuthenticationSession`, or `iosCustomBrowser` | None (the system controls it) | `'unsupported'` |
| `'safariViewController'` | `SFSafariViewController` | Bar and tint colors, dismiss button style, bar collapsing, presentation style | `'unsupported'` |
| `'webView'` | Embedded `WKWebView` | Everything | Two-way |

| `browser.androidMode` | User agent | Header customization | postMessage |
| --- | --- | --- | --- |
| `'customTab'` (default) | Custom Tabs, or a partial Custom Tab | Colors (light and dark), title, close button icon and position, share, URL-bar hiding, menu items, animations | Two-way, but needs Digital Asset Links |
| `'webView'` | Embedded `WebView` activity | Everything | Two-way |

> ⚠️ **Embedded web views.** [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252#section-8.12) discourages them. Some identity providers block them, including Google. The app can also read everything typed into an embedded web view, so use `'webView'` only with identity providers you control. Restrict it with `messaging.allowedOrigins` and `webViewAllowedHosts`.

## Header options (`browser.header`)

| Option | Custom Tabs | SFSafariVC | Web view (iOS/Android) |
| --- | --- | --- | --- |
| `backgroundColor` | ✅ toolbar | ✅ `preferredBarTintColor` | ✅ |
| `tintColor` | – | ✅ `preferredControlTintColor` | ✅ |
| `titleColor` | – | – | ✅ |
| `secondaryColor` | ✅ bottom toolbar | – | – |
| `navigationBarColor`, `navigationBarDividerColor` | ✅ | – | ✅ (Android) |
| `progressColor`, `showProgress` | – | – | ✅ |
| `dark: { …colors }` | ✅ | ✅ | ✅ |
| `colorScheme: 'system' \| 'light' \| 'dark'` | ✅ | ✅ | ✅ |
| `title` | – | – | ✅ |
| `showTitle` | ✅ | – | ✅ |
| `showUrl` (host under the title) | – | – | ✅ |
| `hidden` | – | – | ✅ |
| `hideUrlBarOnScroll` | ✅ | ✅ (bar collapsing) | ✅ (iOS: hides on swipe) |
| `shareButton` | ✅ | – | – |
| `closeButton.position: 'start' \| 'end'` | ✅ | – | ✅ |
| `closeButton.style` | `'close'`, `'back'` | `'done'`, `'close'`, `'cancel'` | all |
| `closeButton.text`, `closeButton.hidden` | – | – | ✅ |
| `buttons: [{ id, title, position }]` | ✅ (as overflow menu items) | – | ✅ |

Pressing a custom header button emits a `headerButtonPress` event with `buttonId` set.

## Other options

| Option | Applies to |
| --- | --- |
| `headers` | Web view: always. Custom Tabs: CORS-safelisted headers, or any header when Digital Asset Links verifies the origin. iOS `'system'`: iOS 17.4+. |
| `userAgent` | Web view |
| `iosPresentationStyle`, `iosModalInPresentation` | SFSafariVC and web view |
| `iosEntersReaderIfAvailable` | SFSafariVC |
| `androidPartial: { height, width, breakpoint, cornerRadius, resizable, backgroundInteraction }` | Custom Tabs. Needs a browser that supports partial tabs (Chrome 107+); otherwise a full tab opens. |
| `androidAnimation: 'default' \| 'slide' \| 'fade' \| 'none'` | Custom Tabs and web view |
| `clearWebViewData` | Web view. Starts with empty cookies and storage. |
| `webViewAllowedHosts` | Web view. Other hosts open in the system browser. Supports `*.example.com`. |
| `onMessage(message, event)`, `onEvent(event)` | Callbacks scoped to this flow. They're removed when the flow ends. |

## Loader (web view modes)

Show your own React component over the embedded web view until the first page has loaded. Mount the provider once:

```jsx
import { AppAuthProvider } from 'react-native-secure-auth';

<AppAuthProvider loader={<MySpinner />} backgroundColor="#ffffff" fadeDuration={200}>
  <App />
</AppAuthProvider>
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

### Android Custom Tabs

Custom Tabs postMessage uses the browser's `requestPostMessageChannel`. The browser only opens the channel when your app is verified for `messaging.androidOrigin` through [Digital Asset Links](https://developer.android.com/develop/ui/views/layout/webapps/digital-asset-links), using the `delegate_permission/common.use_as_origin` relation:

```json
[{
  "relation": ["delegate_permission/common.use_as_origin"],
  "target": { "namespace": "android_app", "package_name": "com.example.app",
              "sha256_cert_fingerprints": ["…"] }
}]
```

```js
browser: { messaging: { androidOrigin: 'https://login.example.com' } }
```

The page receives the app's messages as `message` events on `window`. It replies through the port attached to the first message: `event.ports[0].postMessage(...)`. If verification fails, a `messageChannelFailed` event is emitted and messages stay queued.

### iOS system and Safari modes

Apple doesn't let apps message pages loaded in `ASWebAuthenticationSession` or `SFSafariViewController`. While one of these is open, `postMessage()` returns `'unsupported'`, and queued messages are kept for the next web view flow. To send data to the server in these modes, use `additionalParameters`, or `browser.headers` on iOS 17.4+.

## Events

`addBrowserEventListener(event => …)` receives these `type` values:

| Event | Emitted |
| --- | --- |
| `opened`, `closed` | Every mode |
| `navigationStarted`, `navigationFinished`, `navigationFailed` | Custom Tabs, SFSafariVC, web view |
| `navigationAborted`, `tabShown`, `tabHidden` | Custom Tabs |
| `messageChannelReady`, `messageChannelFailed`, `message` | Modes that support messaging |
| `headerButtonPress` | Custom Tabs (menu items) and web view |

`event.mode` is one of `'customTab'`, `'webView'`, `'system'`, or `'safariViewController'`.
