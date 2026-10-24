import React from 'react';
import { AppRegistry, processColor } from 'react-native';

export const LOADER_APP_KEY = 'RNAppAuthLoader';

let current = null;
let registered = false;

const renderLoader = (loader) => {
  if (loader === undefined || loader === null || loader === false) {
    return null;
  }
  if (React.isValidElement(loader)) {
    return loader;
  }
  if (typeof loader === 'function' || (typeof loader === 'object' && loader.$$typeof)) {
    return React.createElement(loader);
  }
  return null;
};

// Rendered by a native surface placed over the embedded web view, in the same JS runtime.
// React context of the app tree is not available inside it.
const LoaderRoot = () => current && renderLoader(current.loader);

const register = () => {
  if (!registered) {
    registered = true;
    AppRegistry.registerComponent(LOADER_APP_KEY, () => LoaderRoot);
  }
};

/**
 * Mount once near the root of the app. `loader` (an element or a component) is shown over the
 * embedded web view (`browser.iosMode` / `browser.androidMode: 'webView'`) until the first page
 * has loaded. Custom Tabs, SFSafariViewController and ASWebAuthenticationSession are drawn by the
 * system and can't show it.
 */
export const AppAuthProvider = ({ loader, backgroundColor, fadeDuration, children }) => {
  // Registered synchronously so a surface can start even before effects have run.
  register();
  current = { loader, backgroundColor, fadeDuration };

  React.useEffect(
    () => () => {
      current = null;
    },
    []
  );

  return children === undefined ? null : children;
};

/** Options sent to native for the current call, or `undefined` when no loader should show. */
export const getLoaderOptions = (override) => {
  if (override === false || !current || !renderLoader(current.loader)) {
    return undefined;
  }
  const source = { ...current, ...(override && typeof override === 'object' ? override : {}) };
  const options = { component: LOADER_APP_KEY };
  if (source.backgroundColor !== undefined && source.backgroundColor !== null) {
    const color = processColor(source.backgroundColor);
    if (typeof color !== 'number') {
      throw new Error('Config error: loader backgroundColor must be a valid color');
    }
    options.backgroundColor = color;
  }
  if (typeof source.fadeDuration === 'number' && source.fadeDuration >= 0) {
    options.fadeDuration = source.fadeDuration;
  }
  return options;
};
