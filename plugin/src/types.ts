import { ConfigPlugin } from '@expo/config-plugins';

export interface AppAuthProps {
  /** Redirect URLs. The scheme of the first entry is registered on both platforms. */
  redirectUrls?: string[];
  ios?: {
    /** Custom URL scheme(s) registered in CFBundleURLTypes. */
    urlScheme?: string | string[];
    /**
     * Browser schemes added to LSApplicationQueriesSchemes so `iosCustomBrowser`
     * can detect installed browsers. Pass `true` for chrome/opera/firefox/edge.
     */
    customBrowserQuerySchemes?: boolean | string[];
  };
  android?: {
    /** Value for the `appAuthRedirectScheme` manifest placeholder. */
    appAuthRedirectScheme?: string;
    /** Forward activity results to RNAppAuthModule from MainActivity. Default true. */
    patchMainActivity?: boolean;
  };
}

export type AppAuthConfigPlugin = ConfigPlugin<AppAuthProps | undefined>;
