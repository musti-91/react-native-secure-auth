import { ConfigPlugin, withMainActivity } from '@expo/config-plugins';

const STASH_RE = /RNAppAuthModule\s*\.\s*stashAuthorizationResult\s*\(/;

const addImport = (contents: string, name: string, kotlin: boolean) => {
  if (new RegExp(`^import\\s+${name.replace(/\./g, '\\.')}\\b`, 'm').test(contents)) return contents;
  return contents.replace(/^(package\s+[^\n]+\n)/m, `$1\nimport ${name}${kotlin ? '' : ';'}\n`);
};

export const applyMainActivityPatch = (contents: string, language: 'kt' | 'java' = 'kt'): string => {
  if (STASH_RE.test(contents)) return contents;
  const kotlin = language === 'kt';
  if (/\bonActivityResult\s*\(/.test(contents)) {
    // Inject into an existing override, right after the opening brace.
    const re = kotlin
      ? /(override\s+fun\s+onActivityResult\s*\([^)]*\)\s*\{)/
      : /(public\s+void\s+onActivityResult\s*\([^)]*\)\s*\{)/;
    if (!re.test(contents)) {
      throw new Error('react-native-secure-auth: cannot patch onActivityResult automatically; forward results manually (see README)');
    }
    const line = kotlin
      ? '\n    if (requestCode == RNAppAuthModule.AUTHORIZATION_REQUEST_CODE) RNAppAuthModule.stashAuthorizationResult(data)'
      : '\n    if (requestCode == RNAppAuthModule.AUTHORIZATION_REQUEST_CODE) RNAppAuthModule.stashAuthorizationResult(data);';
    return addImport(contents.replace(re, `$1${line}`), 'com.rnappauth.RNAppAuthModule', kotlin);
  }
  if (!/\n}\s*$/.test(contents)) {
    throw new Error('react-native-secure-auth: could not find the end of the MainActivity class');
  }
  const method = kotlin
    ? `
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == RNAppAuthModule.AUTHORIZATION_REQUEST_CODE) {
      RNAppAuthModule.stashAuthorizationResult(data)
    }
    super.onActivityResult(requestCode, resultCode, data)
  }
}
`
    : `
  @Override
  public void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode == RNAppAuthModule.AUTHORIZATION_REQUEST_CODE) {
      RNAppAuthModule.stashAuthorizationResult(data);
    }
    super.onActivityResult(requestCode, resultCode, data);
  }
}
`;
  let out = contents.replace(/\n}\s*$/, method);
  out = addImport(out, 'com.rnappauth.RNAppAuthModule', kotlin);
  out = addImport(out, 'android.content.Intent', kotlin);
  return out;
};

export const withAppAuthMainActivity: ConfigPlugin = config =>
  withMainActivity(config, mod => {
    mod.modResults.contents = applyMainActivityPatch(mod.modResults.contents, mod.modResults.language as any);
    return mod;
  });
