import { ConfigPlugin, InfoPlist, withInfoPlist } from '@expo/config-plugins';
import { AppAuthProps } from '../types';

export const DEFAULT_BROWSER_QUERY_SCHEMES = [
  'googlechrome',
  'googlechromes',
  'opera-http',
  'opera-https',
  'firefox',
  'microsoft-edge-http',
  'microsoft-edge-https',
];

export const applyInfoPlist = (plist: InfoPlist, props?: AppAuthProps): InfoPlist => {
  const schemes = ([] as string[]).concat(props?.ios?.urlScheme || []).filter(Boolean);
  if (schemes.length) {
    plist.CFBundleURLTypes = plist.CFBundleURLTypes || [];
    for (const scheme of schemes) {
      const exists = plist.CFBundleURLTypes.some((t) => t.CFBundleURLSchemes?.includes(scheme));
      if (!exists) {
        plist.CFBundleURLTypes.push({
          CFBundleURLName: '$(PRODUCT_BUNDLE_IDENTIFIER)',
          CFBundleURLSchemes: [scheme],
        });
      }
    }
  }
  const query = props?.ios?.customBrowserQuerySchemes;
  if (query) {
    const list = query === true ? DEFAULT_BROWSER_QUERY_SCHEMES : query;
    const current = (plist.LSApplicationQueriesSchemes as string[] | undefined) || [];
    plist.LSApplicationQueriesSchemes = Array.from(new Set([...current, ...list]));
  }
  return plist;
};

export const withAppAuthInfoPlist: ConfigPlugin<AppAuthProps | undefined> = (config, props) =>
  withInfoPlist(config, (mod) => {
    mod.modResults = applyInfoPlist(mod.modResults, props);
    return mod;
  });
