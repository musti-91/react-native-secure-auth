import { ConfigPlugin, withAppBuildGradle } from '@expo/config-plugins';
import { AppAuthProps } from '../types';

const KEY = 'appAuthRedirectScheme';

const findBlock = (contents: string, name: string): { open: number; close: number } | null => {
  const re = new RegExp(`\\b${name}\\s*\\{`, 'g');
  const m = re.exec(contents);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < contents.length; i++) {
    const c = contents[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { open, close: i };
  }
  return null;
};

export const applyRedirectSchemePlaceholder = (contents: string, scheme?: string): string => {
  if (!scheme) return contents;
  const block = findBlock(contents, 'defaultConfig');
  if (!block) throw new Error('react-native-secure-auth: could not find defaultConfig in app/build.gradle');
  const escaped = scheme.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const body = contents.slice(block.open + 1, block.close);

  // Already set via dotted assignment → replace value.
  const dotted = new RegExp(`(manifestPlaceholders\\s*\\.\\s*${KEY}\\s*=\\s*)(["'])(?:\\\\.|(?!\\2).)*\\2`);
  // Already set inside a map literal → replace value.
  const inMap = new RegExp(`(\\b${KEY}\\s*:\\s*)(["'])(?:\\\\.|(?!\\2).)*\\2`);
  let next: string;
  if (dotted.test(body)) next = body.replace(dotted, `$1'${escaped}'`);
  else if (inMap.test(body)) next = body.replace(inMap, `$1'${escaped}'`);
  else {
    const indent = (body.match(/\n([ \t]+)\S/) || [, '        '])[1];
    next = `${body.replace(/\s*$/, '')}\n${indent}manifestPlaceholders.${KEY} = '${escaped}'\n${
      (contents.slice(0, block.close).match(/\n([ \t]*)$/) || [, '    '])[1]
    }`;
  }
  return contents.slice(0, block.open + 1) + next + contents.slice(block.close);
};

export const withAppAuthAppBuildGradle: ConfigPlugin<AppAuthProps | undefined> = (config, props) =>
  withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('react-native-secure-auth: only Groovy app/build.gradle is supported by the config plugin');
    }
    mod.modResults.contents = applyRedirectSchemePlaceholder(
      mod.modResults.contents,
      props?.android?.appAuthRedirectScheme,
    );
    return mod;
  });
