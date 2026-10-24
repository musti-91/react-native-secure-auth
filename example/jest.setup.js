const { NativeModules } = require('react-native');

NativeModules.RNAppAuth = {
  prefetchConfiguration: jest.fn(),
  postBrowserMessage: jest.fn(() => Promise.resolve('queued')),
  clearPendingBrowserMessages: jest.fn(() => Promise.resolve()),
  dismissBrowser: jest.fn(() => Promise.resolve(false)),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
