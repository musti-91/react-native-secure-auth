import { createRunOncePlugin, withPlugins } from '@expo/config-plugins';
import { AppAuthConfigPlugin, AppAuthProps } from './types';
import { withAppAuthAppDelegate, withBridgingHeader, withAppAuthInfoPlist } from './ios';
import { withAppAuthAppBuildGradle, withAppAuthMainActivity } from './android';

const pkg = require('../../package.json');

export const getRedirectUrlScheme = (redirectUrl?: string): string | undefined => {
  if (!redirectUrl) return undefined;
  const idx = redirectUrl.indexOf(':');
  if (idx <= 0) return undefined;
  const scheme = redirectUrl.slice(0, idx);
  return /^(https?)$/i.test(scheme) ? undefined : scheme;
};

export const resolveProps = (props?: AppAuthProps): AppAuthProps => {
  const scheme = getRedirectUrlScheme(props?.redirectUrls?.[0]);
  return {
    ...props,
    ios: { urlScheme: scheme, ...props?.ios },
    android: { appAuthRedirectScheme: scheme, ...props?.android },
  };
};

const withAppAuth: AppAuthConfigPlugin = (config, rawProps) => {
  const props = resolveProps(rawProps);
  const plugins: any[] = [
    withBridgingHeader,
    withAppAuthAppDelegate,
    [withAppAuthInfoPlist, props],
    [withAppAuthAppBuildGradle, props],
  ];
  if (props.android?.patchMainActivity !== false) plugins.push(withAppAuthMainActivity);
  return withPlugins(config, plugins);
};

export type { AppAuthProps } from './types';
export default createRunOncePlugin(withAppAuth, pkg.name, pkg.version);
