export function invariant(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.name = 'Invariant Violation';
    throw error;
  }
}

export const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const encodeFormComponent = (value) =>
  encodeURIComponent(value)
    .replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const utf8Encode = (input) => {
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    let codePoint = input.codePointAt(i);
    if (codePoint > 0xffff) {
      i++;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
};

const utf8Decode = (bytes) => {
  let output = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i++];
    let codePoint;
    if (byte < 0x80) {
      codePoint = byte;
    } else if (byte < 0xe0) {
      codePoint = ((byte & 0x1f) << 6) | (bytes[i++] & 0x3f);
    } else if (byte < 0xf0) {
      codePoint = ((byte & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else {
      codePoint =
        ((byte & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    }
    output += String.fromCodePoint(codePoint);
  }
  return output;
};

export const base64Encode = (input) => {
  const bytes = utf8Encode(String(input));
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += i + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : '=';
  }
  return output;
};

export const base64UrlDecode = (input) => {
  const normalized = String(input).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < normalized.length; i++) {
    const value = BASE64_ALPHABET.indexOf(normalized[i]);
    if (value === -1) {
      throw new Error('Invalid base64 input');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
};

export const stripTrailingSlash = (url) => (url.endsWith('/') ? url.slice(0, -1) : url);
