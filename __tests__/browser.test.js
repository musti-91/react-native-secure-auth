import { setPlatform, resetNativeModule } from '../jest/nativeMock';
import { normalizeBrowserOptions, serializeMessage, parseMessage } from '../src/browser';
import { postMessage, dismissBrowser, clearPendingMessages } from '../src';

describe('normalizeBrowserOptions', () => {
  it('returns null without a browser config', () => {
    expect(normalizeBrowserOptions(undefined, 'ios')).toBeNull();
  });

  it('picks the platform mode with sensible defaults', () => {
    const browser = { iosMode: 'safariViewController', androidMode: 'webView' };
    expect(normalizeBrowserOptions(browser, 'ios').mode).toBe('safariViewController');
    expect(normalizeBrowserOptions(browser, 'android').mode).toBe('webView');
    expect(normalizeBrowserOptions({}, 'ios').mode).toBe('system');
    expect(normalizeBrowserOptions({}, 'android').mode).toBe('customTab');
  });

  it('converts header colors (including dark overrides) to native colors', () => {
    const { header } = normalizeBrowserOptions(
      {
        header: {
          backgroundColor: '#ff0000',
          dark: { backgroundColor: 'black' },
          closeButton: { style: 'back', position: 'end' },
          buttons: [{ id: 'help', title: 'Help' }],
        },
      },
      'android'
    );
    expect(typeof header.backgroundColor).toBe('number');
    expect(typeof header.dark.backgroundColor).toBe('number');
    expect(header.closeButton).toEqual({ style: 'back', position: 'end' });
    expect(header.buttons).toEqual([{ id: 'help', title: 'Help' }]);
    expect(header).not.toHaveProperty('tintColor');
  });

  it('maps platform specific keys and serializes initial messages', () => {
    const options = normalizeBrowserOptions(
      {
        iosPresentationStyle: 'pageSheet',
        androidAnimation: 'slide',
        androidPartial: { height: 400 },
        webViewAllowedHosts: ['*.example.com'],
        messaging: {
          initialMessages: [{ hello: 1 }, 'raw'],
          allowedOrigins: ['https://example.com'],
        },
      },
      'ios'
    );
    expect(options).toMatchObject({
      presentationStyle: 'pageSheet',
      animation: 'slide',
      partial: { height: 400 },
      allowedHosts: ['*.example.com'],
      messaging: {
        initialMessages: ['{"hello":1}', 'raw'],
        allowedOrigins: ['https://example.com'],
      },
    });
  });

  it.each([
    [{ header: { backgroundColor: 'not-a-color' } }, /backgroundColor/],
    [{ header: { closeButton: { style: 'x' } } }, /closeButton.style/],
    [
      {
        header: {
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'a', title: 'B' },
          ],
        },
      },
      /duplicate/,
    ],
    [{ headers: { a: 1 } }, /headers/],
    [{ androidPartial: { height: -1 } }, /height/],
    [{ messaging: { allowedOrigins: [1] } }, /allowedOrigins/],
  ])('rejects invalid config %#', (browser, message) => {
    expect(() => normalizeBrowserOptions(browser, 'ios')).toThrow(message);
  });
});

describe('messages', () => {
  it('serializes objects to JSON and keeps strings', () => {
    expect(serializeMessage('hi')).toBe('hi');
    expect(serializeMessage({ a: 1 })).toBe('{"a":1}');
    expect(() => serializeMessage(undefined)).toThrow();
  });

  it('parses JSON payloads and leaves other strings untouched', () => {
    expect(parseMessage('{"a":1}')).toEqual({ a: 1 });
    expect(parseMessage('[1]')).toEqual([1]);
    expect(parseMessage('{broken')).toBe('{broken');
    expect(parseMessage('plain')).toBe('plain');
  });

  it('forwards postMessage / dismiss / clear to native', async () => {
    setPlatform('ios');
    const native = resetNativeModule();
    await expect(postMessage({ token: 'x' })).resolves.toBe('queued');
    expect(native.postBrowserMessage).toHaveBeenCalledWith('{"token":"x"}');
    await expect(dismissBrowser()).resolves.toBe(true);
    await clearPendingMessages();
    expect(native.clearPendingBrowserMessages).toHaveBeenCalled();
  });
});
