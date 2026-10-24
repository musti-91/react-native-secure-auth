import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  addBrowserEventListener,
  authorize,
  AuthConfiguration,
  AuthorizeResult,
  BrowserOptions,
  createTokenRefresher,
  decodeJwt,
  dismissBrowser,
  getErrorReason,
  isUserCancelledError,
  logout,
  postMessage,
  prefetchConfiguration,
  refresh,
  TokenRefresher,
} from 'react-native-secure-auth';

const config: AuthConfiguration = {
  serviceConfiguration: {
    authorizationEndpoint: '',
    tokenEndpoint: '',
  },
  clientId: '',
  clientSecret: '',
  redirectUrl: '',
  scopes: [],
  usePKCE: true,
  additionalParameters: { prompt: 'login' },
  dangerouslyAllowInsecureHttpRequests: false,
  iosPrefersEphemeralSession: true,
  clientAuthMethod: 'post',
};

type Mode = 'default' | 'styled' | 'webView' | 'partial';

const browserFor = (mode: Mode): BrowserOptions | undefined => {
  const header = {
    backgroundColor: '#ff0000',
    tintColor: '#FFFFFF',
    titleColor: '#FFFFFF',
    progressColor: '#ffffff',
    dark: { backgroundColor: '#ff0000' },
    showTitle: true,
    showUrl: false,
    showProgress: false,
    closeButton: { position: 'start' as const, style: 'close' as const },
    buttons: [
      {
        id: 'help',
        title: 'Help',
        onPress: () => {
          postMessage({ type: 'help-requested' });
        },
      },
    ],
    loader: {
      backgroundColor: '#ff0000',
    },
  };
  switch (mode) {
    case 'default':
      return undefined;
    case 'styled':
      return {
        iosMode: 'safariViewController',
        androidMode: 'customTab',
        header: { ...header, title: undefined, closeButton: { style: 'done' } },
        androidAnimation: 'slide',
      };
    case 'webView':
      return {
        iosMode: 'webView',
        androidMode: 'webView',
        header: { ...header, title: 'WebView' },
        messaging: {
          initialMessages: [{ type: 'hello', from: 'react-native' }],
          allowedOrigins: ['https://demo.duendesoftware.com'],
        },
        webViewAllowedHosts: ['demo.duendesoftware.com'],
        iosPresentationStyle: 'pageSheet',
        onMessage: message => console.log('[flow] page message', message),
      };
    case 'partial':
      return {
        androidMode: 'customTab',
        iosMode: 'safariViewController',
        iosPresentationStyle: 'formSheet',
        header: { backgroundColor: '#065F46', showTitle: true },
        androidPartial: {
          height: 600,
          cornerRadius: 16,
          backgroundInteraction: true,
        },
      };
  }
};

function Button({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        (pressed || disabled) && styles.buttonDim,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthorizeResult | null>(null);
  const [mode, setMode] = useState<Mode>('default');
  const [log, setLog] = useState<string[]>([]);
  const refresher = useRef<TokenRefresher | null>(null);

  const append = (line: string) =>
    setLog(prev =>
      [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 50),
    );

  useEffect(() => {
    prefetchConfiguration(config).catch(() => {});
    const sub = addBrowserEventListener(event => {
      append(
        `${event.type}${event.mode ? ` [${event.mode}]` : ''}${
          event.url ? ` ${event.url}` : ''
        }${event.data ? ` ${event.data}` : ''}${
          event.buttonId ? ` ${event.buttonId}` : ''
        }`,
      );
      if (event.type === 'headerButtonPress' && event.buttonId === 'help') {
        postMessage({ type: 'help-requested' });
      }
    });
    return () => {
      sub.remove();
      refresher.current?.stop();
    };
  }, []);

  const claims = useMemo(() => {
    try {
      return auth?.idToken ? decodeJwt(auth.idToken).payload : null;
    } catch {
      return null;
    }
  }, [auth]);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e: any) {
      if (isUserCancelledError(e)) append('cancelled by user');
      else Alert.alert('Error', `${getErrorReason(e)}: ${e?.message}`);
    }
  };

  const onAuthorize = () =>
    run(async () => {
      // Queued before the browser opens; delivered when its message channel is ready.
      const queued = await postMessage({ type: 'prefill', loginHint: 'bob' });
      append(`postMessage before open → ${queued}`);
      const result = await authorize({ ...config, browser: browserFor(mode) });
      setAuth(result);
      refresher.current?.stop();
      refresher.current = createTokenRefresher(config, result, {
        onRefresh: r => {
          setAuth(prev =>
            prev
              ? {
                  ...prev,
                  ...r,
                  refreshToken: r.refreshToken || prev.refreshToken,
                }
              : prev,
          );
          append('auto-refreshed');
        },
        onError: err => append(`refresher stopped: ${err.message}`),
      }).start();
      append('authorized');
    });

  const onRefresh = () =>
    run(async () => {
      if (!auth?.refreshToken) return;
      const r = await refresh(config, { refreshToken: auth.refreshToken });
      setAuth({
        ...auth,
        ...r,
        refreshToken: r.refreshToken || auth.refreshToken,
      });
      append('refreshed');
    });

  const onLogout = () =>
    run(async () => {
      if (!auth?.idToken) return;
      refresher.current?.stop();
      await logout(
        { ...config, browser: browserFor(mode) },
        { idToken: auth.idToken, postLogoutRedirectUrl: config.redirectUrl },
      );
      setAuth(null);
      append('logged out');
    });

  const onAutoDismiss = () => {
    setTimeout(
      () => dismissBrowser().then(d => append(`dismissBrowser → ${d}`)),
      8000,
    );
    onAuthorize();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>react-native-secure-auth</Text>
        <Text style={styles.subtitle}>
          {auth
            ? `Signed in as ${
                (claims as any)?.name ?? (claims as any)?.sub ?? 'user'
              }`
            : 'Signed out'}
        </Text>

        <Text style={styles.section}>Browser mode ({Platform.OS})</Text>
        <View style={styles.row}>
          {(['default', 'styled', 'webView', 'partial'] as Mode[]).map(m => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[styles.chip, mode === m && styles.chipActive]}
            >
              <Text style={mode === m ? styles.chipTextActive : undefined}>
                {m}
              </Text>
            </Pressable>
          ))}
        </View>

        <Button title="Authorize" onPress={onAuthorize} />
        <Button title="Authorize + dismiss after 8s" onPress={onAutoDismiss} />
        <Button
          title="Refresh"
          onPress={onRefresh}
          disabled={!auth?.refreshToken}
        />
        <Button title="Logout" onPress={onLogout} disabled={!auth?.idToken} />

        {auth && (
          <>
            <Text style={styles.section}>Tokens</Text>
            <Text style={styles.mono} numberOfLines={2}>
              access: {auth.accessToken}
            </Text>
            <Text style={styles.mono}>
              expires: {auth.accessTokenExpirationDate}
            </Text>
          </>
        )}

        <Text style={styles.section}>Browser events</Text>
        {log.map((l, i) => (
          <Text key={i} style={styles.mono}>
            {l}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 20, paddingTop: 40 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { marginTop: 4, color: '#475569' },
  section: {
    marginTop: 24,
    marginBottom: 8,
    fontWeight: '600',
    color: '#1E293B',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
  },
  chipActive: { backgroundColor: '#1E3A8A' },
  chipTextActive: { color: '#FFFFFF' },
  button: {
    backgroundColor: '#1E3A8A',
    padding: 14,
    borderRadius: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  buttonDim: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
    color: '#334155',
  },
});
