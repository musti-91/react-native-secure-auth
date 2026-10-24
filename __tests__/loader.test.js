import React from 'react';
import { AppRegistry, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { normalizeBrowserOptions } from '../src/browser';
import { AppAuthProvider, LOADER_APP_KEY } from '../src/loader';

const mount = (props) => {
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(AppAuthProvider, props));
  });
  return renderer;
};

describe('loader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is not sent without a provider', () => {
    expect(normalizeBrowserOptions({ iosMode: 'webView' }, 'ios').loader).toBeUndefined();
  });

  it('registers the surface and is sent only for web view modes', () => {
    const registerSpy = jest.spyOn(AppRegistry, 'registerComponent');
    const renderer = mount({
      loader: React.createElement(Text, null, 'Loading'),
      backgroundColor: '#ffffff',
    });
    expect(registerSpy).toHaveBeenCalledWith(LOADER_APP_KEY, expect.any(Function));

    const webView = normalizeBrowserOptions({ androidMode: 'webView' }, 'android');
    expect(webView.loader.component).toBe(LOADER_APP_KEY);
    expect(typeof webView.loader.backgroundColor).toBe('number');
    expect(normalizeBrowserOptions({}, 'android').loader).toBeUndefined();

    act(() => renderer.unmount());
    expect(normalizeBrowserOptions({ androidMode: 'webView' }, 'android').loader).toBeUndefined();
  });

  it('can be disabled or overridden per call', () => {
    const renderer = mount({ loader: Text });
    expect(
      normalizeBrowserOptions({ iosMode: 'webView', loader: false }, 'ios').loader
    ).toBeUndefined();
    expect(
      normalizeBrowserOptions({ iosMode: 'webView', loader: { fadeDuration: 0 } }, 'ios').loader
        .fadeDuration
    ).toBe(0);
    act(() => renderer.unmount());
  });
});
