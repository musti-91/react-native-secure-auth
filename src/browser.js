import { NativeEventEmitter, NativeModules, Platform, processColor } from 'react-native';
import { invariant, isPlainObject } from './utils';
import { getLoaderOptions } from './loader';

export const BROWSER_EVENT = 'RNAppAuthBrowserEvent';

const IOS_MODES = ['system', 'safariViewController', 'webView'];
const ANDROID_MODES = ['customTab', 'webView'];
const CLOSE_BUTTON_POSITIONS = ['start', 'end'];
const CLOSE_BUTTON_STYLES = ['close', 'back', 'done', 'cancel'];
const COLOR_SCHEMES = ['system', 'light', 'dark'];
const IOS_PRESENTATION_STYLES = [
  'automatic',
  'fullScreen',
  'pageSheet',
  'formSheet',
  'overFullScreen',
  'popover',
];
const ANDROID_ANIMATIONS = ['default', 'slide', 'fade', 'none'];
const HEADER_COLOR_KEYS = [
  'backgroundColor',
  'tintColor',
  'titleColor',
  'secondaryColor',
  'navigationBarColor',
  'navigationBarDividerColor',
  'progressColor',
];

const getNativeModule = () => NativeModules.RNAppAuth;

const toNativeColor = (value, key) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const color = processColor(value);
  invariant(
    typeof color === 'number',
    `Config error: browser.header.${key} must be a valid color (received ${String(value)})`
  );
  return color;
};

const oneOf = (value, allowed, name) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  invariant(
    allowed.includes(value),
    `Config error: ${name} must be one of ${allowed.map((v) => `'${v}'`).join(', ')}`
  );
  return value;
};

const optionalBoolean = (value, name) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  invariant(typeof value === 'boolean', `Config error: ${name} must be a boolean`);
  return value;
};

const optionalNumber = (value, name) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  invariant(
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
    `Config error: ${name} must be a non-negative number`
  );
  return value;
};

const optionalString = (value, name) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  invariant(typeof value === 'string', `Config error: ${name} must be a string`);
  return value;
};

const compact = (object) => {
  const result = {};
  Object.keys(object).forEach((key) => {
    if (object[key] !== undefined) {
      result[key] = object[key];
    }
  });
  return result;
};

/**
 * Messages are always transported as strings. Objects are JSON encoded so that
 * the web page can `JSON.parse(event.data)` them.
 */
export const serializeMessage = (message) => {
  invariant(message !== undefined, 'postMessage: message must not be undefined');
  if (typeof message === 'string') {
    return message;
  }
  const serialized = JSON.stringify(message);
  invariant(typeof serialized === 'string', 'postMessage: message must be JSON serializable');
  return serialized;
};

export const parseMessage = (data) => {
  if (typeof data !== 'string') {
    return data;
  }
  const trimmed = data.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return data;
    }
  }
  return data;
};

const normalizeCloseButton = (closeButton) => {
  if (closeButton === undefined || closeButton === null) {
    return undefined;
  }
  invariant(
    isPlainObject(closeButton),
    'Config error: browser.header.closeButton must be an object'
  );
  return compact({
    position: oneOf(
      closeButton.position,
      CLOSE_BUTTON_POSITIONS,
      'browser.header.closeButton.position'
    ),
    style: oneOf(closeButton.style, CLOSE_BUTTON_STYLES, 'browser.header.closeButton.style'),
    text: optionalString(closeButton.text, 'browser.header.closeButton.text'),
    hidden: optionalBoolean(closeButton.hidden, 'browser.header.closeButton.hidden'),
  });
};

const normalizeHeaderButtons = (buttons) => {
  if (buttons === undefined || buttons === null) {
    return undefined;
  }
  invariant(Array.isArray(buttons), 'Config error: browser.header.buttons must be an array');
  const ids = new Set();
  return buttons.map((button, index) => {
    invariant(
      isPlainObject(button) && typeof button.id === 'string' && button.id.length > 0,
      `Config error: browser.header.buttons[${index}].id must be a non-empty string`
    );
    invariant(!ids.has(button.id), `Config error: duplicate header button id '${button.id}'`);
    ids.add(button.id);
    invariant(
      typeof button.title === 'string' && button.title.length > 0,
      `Config error: browser.header.buttons[${index}].title must be a non-empty string`
    );
    return compact({
      id: button.id,
      title: button.title,
      position: oneOf(
        button.position,
        CLOSE_BUTTON_POSITIONS,
        `browser.header.buttons[${index}].position`
      ),
    });
  });
};

const normalizeColors = (source, prefix) => {
  const colors = {};
  HEADER_COLOR_KEYS.forEach((key) => {
    colors[key] = toNativeColor(source[key], prefix ? `${prefix}.${key}` : key);
  });
  return colors;
};

export const normalizeHeader = (header) => {
  if (header === undefined || header === null) {
    return undefined;
  }
  invariant(isPlainObject(header), 'Config error: browser.header must be an object');

  let dark;
  if (header.dark !== undefined && header.dark !== null) {
    invariant(isPlainObject(header.dark), 'Config error: browser.header.dark must be an object');
    dark = compact(normalizeColors(header.dark, 'dark'));
  }

  return compact({
    ...normalizeColors(header, ''),
    dark,
    title: optionalString(header.title, 'browser.header.title'),
    showTitle: optionalBoolean(header.showTitle, 'browser.header.showTitle'),
    showUrl: optionalBoolean(header.showUrl, 'browser.header.showUrl'),
    hidden: optionalBoolean(header.hidden, 'browser.header.hidden'),
    hideUrlBarOnScroll: optionalBoolean(
      header.hideUrlBarOnScroll,
      'browser.header.hideUrlBarOnScroll'
    ),
    shareButton: optionalBoolean(header.shareButton, 'browser.header.shareButton'),
    showProgress: optionalBoolean(header.showProgress, 'browser.header.showProgress'),
    colorScheme: oneOf(header.colorScheme, COLOR_SCHEMES, 'browser.header.colorScheme'),
    closeButton: normalizeCloseButton(header.closeButton),
    buttons: normalizeHeaderButtons(header.buttons),
  });
};

const normalizePartial = (partial) => {
  if (partial === undefined || partial === null) {
    return undefined;
  }
  invariant(isPlainObject(partial), 'Config error: browser.androidPartial must be an object');
  return compact({
    height: optionalNumber(partial.height, 'browser.androidPartial.height'),
    width: optionalNumber(partial.width, 'browser.androidPartial.width'),
    breakpoint: optionalNumber(partial.breakpoint, 'browser.androidPartial.breakpoint'),
    cornerRadius: optionalNumber(partial.cornerRadius, 'browser.androidPartial.cornerRadius'),
    resizable: optionalBoolean(partial.resizable, 'browser.androidPartial.resizable'),
    backgroundInteraction: optionalBoolean(
      partial.backgroundInteraction,
      'browser.androidPartial.backgroundInteraction'
    ),
  });
};

const normalizeBridgeName = (name) => {
  if (name === undefined || name === null) {
    return undefined;
  }
  invariant(
    typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name),
    'Config error: browser.messaging.bridgeName must be a valid JavaScript identifier'
  );
  return name;
};

const normalizeMessaging = (messaging) => {
  if (messaging === undefined || messaging === null) {
    return undefined;
  }
  invariant(isPlainObject(messaging), 'Config error: browser.messaging must be an object');
  let initialMessages;
  if (messaging.initialMessages !== undefined && messaging.initialMessages !== null) {
    invariant(
      Array.isArray(messaging.initialMessages),
      'Config error: browser.messaging.initialMessages must be an array'
    );
    initialMessages = messaging.initialMessages.map(serializeMessage);
  }
  return compact({
    enabled: optionalBoolean(messaging.enabled, 'browser.messaging.enabled'),
    initialMessages,
    bridgeName: normalizeBridgeName(messaging.bridgeName),
    androidOrigin: optionalString(messaging.androidOrigin, 'browser.messaging.androidOrigin'),
    androidTargetOrigin: optionalString(
      messaging.androidTargetOrigin,
      'browser.messaging.androidTargetOrigin'
    ),
    allowedOrigins: messaging.allowedOrigins
      ? (invariant(
          Array.isArray(messaging.allowedOrigins) &&
            messaging.allowedOrigins.every((o) => typeof o === 'string'),
          'Config error: browser.messaging.allowedOrigins must be an array of strings'
        ),
        messaging.allowedOrigins)
      : undefined,
  });
};

/**
 * Converts the user facing `browser` config into the flat, JSON-safe structure
 * consumed by the native modules. Returns `null` when no option is set so the
 * native side can keep its default behaviour.
 */
export const normalizeBrowserOptions = (browser, platform = Platform.OS) => {
  if (browser === undefined || browser === null) {
    return null;
  }
  invariant(isPlainObject(browser), 'Config error: browser must be an object');

  const headers = browser.headers;
  if (headers !== undefined && headers !== null) {
    invariant(
      isPlainObject(headers) && Object.values(headers).every((v) => typeof v === 'string'),
      'Config error: browser.headers must be { [key: string]: string }'
    );
  }

  const iosMode = oneOf(browser.iosMode, IOS_MODES, 'browser.iosMode');
  const androidMode = oneOf(browser.androidMode, ANDROID_MODES, 'browser.androidMode');

  const mode = platform === 'ios' ? iosMode || 'system' : androidMode || 'customTab';
  const options = compact({
    mode,
    loader: mode === 'webView' ? getLoaderOptions(browser.loader) : undefined,
    header: normalizeHeader(browser.header),
    headers: headers || undefined,
    userAgent: optionalString(browser.userAgent, 'browser.userAgent'),
    messaging: normalizeMessaging(browser.messaging),
    presentationStyle: oneOf(
      browser.iosPresentationStyle,
      IOS_PRESENTATION_STYLES,
      'browser.iosPresentationStyle'
    ),
    modalInPresentation: optionalBoolean(
      browser.iosModalInPresentation,
      'browser.iosModalInPresentation'
    ),
    entersReaderIfAvailable: optionalBoolean(
      browser.iosEntersReaderIfAvailable,
      'browser.iosEntersReaderIfAvailable'
    ),
    partial: normalizePartial(browser.androidPartial),
    animation: oneOf(browser.androidAnimation, ANDROID_ANIMATIONS, 'browser.androidAnimation'),
    clearWebViewData: optionalBoolean(browser.clearWebViewData, 'browser.clearWebViewData'),
    allowedHosts: browser.webViewAllowedHosts
      ? (invariant(
          Array.isArray(browser.webViewAllowedHosts) &&
            browser.webViewAllowedHosts.every((h) => typeof h === 'string'),
          'Config error: browser.webViewAllowedHosts must be an array of strings'
        ),
        browser.webViewAllowedHosts)
      : undefined,
    deepLinkUrls: browser.androidDeepLinkUrls
      ? (invariant(
          Array.isArray(browser.androidDeepLinkUrls) &&
            browser.androidDeepLinkUrls.every((u) => typeof u === 'string' && u.length > 0),
          'Config error: browser.androidDeepLinkUrls must be an array of non-empty strings'
        ),
        browser.androidDeepLinkUrls)
      : undefined,
  });

  return options;
};

let emitter = null;
const getEmitter = () => {
  if (!emitter) {
    emitter = new NativeEventEmitter(getNativeModule());
  }
  return emitter;
};

/**
 * Subscribe to every browser event (opened, closed, navigation, message, ...).
 */
export const addBrowserEventListener = (listener) => {
  invariant(typeof listener === 'function', 'addBrowserEventListener: listener must be a function');
  return getEmitter().addListener(BROWSER_EVENT, listener);
};

/**
 * Subscribe to messages posted by the page loaded in the authorization browser.
 * The listener receives the parsed payload (JSON decoded when possible) and the raw event.
 */
export const addMessageListener = (listener) => {
  invariant(typeof listener === 'function', 'addMessageListener: listener must be a function');
  return addBrowserEventListener((event) => {
    if (event && event.type === 'message') {
      listener(parseMessage(event.data), event);
    }
  });
};

/**
 * Sends a message to the page loaded in the authorization browser.
 * If no browser is open yet, the message is queued and delivered as soon as the
 * next browser session opens a messaging channel.
 *
 * Resolves with 'delivered', 'queued' or 'unsupported'.
 *
 * With `{ throwIfNotOpen: true }` the message is never queued: it rejects unless the message was
 * delivered right away to an open authorize/logout browser. The error has
 * `code: 'message_not_delivered'` and `result` set to 'notOpen' (no browser open, or its messaging
 * channel isn't ready yet) or 'unsupported'. Messages already in the queue are left untouched.
 */
export const postMessage = async (message, options) => {
  const payload = serializeMessage(message);
  if (!(options && options.throwIfNotOpen)) {
    return getNativeModule().postBrowserMessage(payload);
  }
  const result = await getNativeModule().postBrowserMessageNow(payload);
  if (result !== 'delivered') {
    const error = new Error(
      result === 'unsupported'
        ? 'postMessage: the open browser does not support messaging, message was not delivered'
        : 'postMessage: no browser is open or its messaging channel is not ready, message was not delivered'
    );
    error.code = 'message_not_delivered';
    error.result = result;
    throw error;
  }
  return result;
};

/** Removes messages queued with postMessage() that were not delivered yet. */
export const clearPendingMessages = () =>
  Promise.resolve(getNativeModule().clearPendingBrowserMessages());

/**
 * Programmatically closes the authorization / logout browser. The pending
 * authorize() or logout() promise rejects with reason 'program_cancelled'.
 * Resolves with `true` when a browser was open.
 */
export const dismissBrowser = () => Promise.resolve(getNativeModule().dismissBrowser());

/** Clears cookies & storage of the embedded web view used by the 'webView' browser mode. */
export const clearWebViewData = () => Promise.resolve(getNativeModule().clearWebViewData());

/**
 * Subscribes the per-call `browser.onMessage` / `browser.onEvent` callbacks for the
 * lifetime of a single authorize()/logout() call.
 */
export const withBrowserCallbacks = (browser, run) => {
  const subscriptions = [];
  if (browser && typeof browser.onEvent === 'function') {
    subscriptions.push(addBrowserEventListener(browser.onEvent));
  }
  if (browser && typeof browser.onMessage === 'function') {
    subscriptions.push(addMessageListener(browser.onMessage));
  }
  if (subscriptions.length === 0) {
    return run();
  }
  const cleanup = () => subscriptions.forEach((subscription) => subscription.remove());
  let result;
  try {
    result = run();
  } catch (error) {
    cleanup();
    throw error;
  }
  return Promise.resolve(result).then(
    (value) => {
      cleanup();
      return value;
    },
    (error) => {
      cleanup();
      throw error;
    }
  );
};
