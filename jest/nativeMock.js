// Shared helpers: a mocked RNAppAuth native module and a switchable Platform.OS.
const { NativeModules, Platform } = require('react-native');

let currentOS = 'ios';
Object.defineProperty(Platform, 'OS', { configurable: true, get: () => currentOS });

const setPlatform = os => {
  currentOS = os;
};

const resetNativeModule = () => {
  NativeModules.RNAppAuth = {
    prefetchConfiguration: jest.fn(() => Promise.resolve()),
    register: jest.fn(() => Promise.resolve({ clientId: 'client' })),
    authorize: jest.fn(() => Promise.resolve({ accessToken: 'access' })),
    resumePendingAuthorize: jest.fn(() => Promise.resolve(null)),
    refresh: jest.fn(() => Promise.resolve({ accessToken: 'refreshed' })),
    logout: jest.fn(() => Promise.resolve({ state: '' })),
    postBrowserMessage: jest.fn(() => Promise.resolve('queued')),
    clearPendingBrowserMessages: jest.fn(() => Promise.resolve()),
    dismissBrowser: jest.fn(() => Promise.resolve(true)),
    clearWebViewData: jest.fn(() => Promise.resolve()),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  return NativeModules.RNAppAuth;
};

module.exports = { setPlatform, resetNativeModule };
