import { applySwiftAppDelegatePatch, applyObjcAppDelegatePatch, ensureBridgingHeaderImport, applyInfoPlist } from '../ios';
import { applyMainActivityPatch, applyRedirectSchemePlaceholder } from '../android';
import { getRedirectUrlScheme, resolveProps } from '../index';

const EXPO_APP_DELEGATE = `import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}
`;

describe('iOS AppDelegate (Swift)', () => {
  it('adds protocol, property and resume hooks, idempotently', () => {
    const out = applySwiftAppDelegatePatch(EXPO_APP_DELEGATE);
    expect(out).toContain('class AppDelegate: ExpoAppDelegate, RNAppAuthAuthorizationFlowManager {');
    expect(out).toContain('weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?');
    expect(out).toMatch(/open url: URL[\s\S]*?\{\n\s+if let flow = authorizationFlowManagerDelegate, flow\.resumeExternalUserAgentFlow\(with: url\)/);
    expect(out).toContain('flow.resumeExternalUserAgentFlow(with: webpageURL)');
    expect(applySwiftAppDelegatePatch(out)).toBe(out);
  });

  it('adds missing override methods', () => {
    const minimal = `import Expo\n\npublic class AppDelegate: ExpoAppDelegate {\n  var window: UIWindow?\n}\n`;
    const out = applySwiftAppDelegatePatch(minimal);
    expect(out).toContain('return super.application(app, open: url, options: options)');
    expect(out).toContain('continue userActivity: NSUserActivity');
    expect(out.trim().endsWith('}')).toBe(true);
  });

  it('patches legacy Objective-C AppDelegate', () => {
    const objc = `- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary *)options {\n  return [super application:application openURL:url options:options];\n}`;
    const out = applyObjcAppDelegatePatch(objc);
    expect(out).toContain('resumeExternalUserAgentFlowWithURL:url');
    expect(applyObjcAppDelegatePatch(out)).toBe(out);
  });
});

describe('iOS Info.plist / bridging header', () => {
  it('registers URL scheme once and merges browser query schemes', () => {
    const plist: any = { LSApplicationQueriesSchemes: ['foo'] };
    applyInfoPlist(plist, { ios: { urlScheme: 'com.example', customBrowserQuerySchemes: true } });
    applyInfoPlist(plist, { ios: { urlScheme: 'com.example' } });
    expect(plist.CFBundleURLTypes).toHaveLength(1);
    expect(plist.LSApplicationQueriesSchemes).toEqual(expect.arrayContaining(['foo', 'googlechrome', 'firefox']));
  });

  it('adds the import once', () => {
    const once = ensureBridgingHeaderImport('#import <Foo/Foo.h>\n');
    expect(ensureBridgingHeaderImport(once)).toBe(once);
    expect(ensureBridgingHeaderImport('#import "RNAppAuthAuthorizationFlowManager.h"\n')).toBe('#import "RNAppAuthAuthorizationFlowManager.h"\n');
  });
});

describe('Android', () => {
  const gradle = `android {\n    defaultConfig {\n        applicationId 'com.example'\n        versionName "1.0.0"\n    }\n}\n`;

  it('adds and then updates the manifest placeholder', () => {
    const out = applyRedirectSchemePlaceholder(gradle, 'com.example');
    expect(out).toContain("        manifestPlaceholders.appAuthRedirectScheme = 'com.example'\n    }");
    expect(applyRedirectSchemePlaceholder(out, 'other')).toContain("appAuthRedirectScheme = 'other'");
    expect(applyRedirectSchemePlaceholder(out, 'other').match(/appAuthRedirectScheme/g)).toHaveLength(1);
  });

  it('updates a placeholder inside a map literal', () => {
    const map = gradle.replace('versionName "1.0.0"', 'manifestPlaceholders = [appAuthRedirectScheme: "old", x: "y"]');
    expect(applyRedirectSchemePlaceholder(map, 'new')).toContain(`[appAuthRedirectScheme: 'new', x: "y"]`);
  });

  it('adds onActivityResult forwarding to Kotlin MainActivity', () => {
    const kt = `package com.example\n\nimport com.facebook.react.ReactActivity\n\nclass MainActivity : ReactActivity() {\n  override fun getMainComponentName(): String = "main"\n}\n`;
    const out = applyMainActivityPatch(kt, 'kt');
    expect(out).toContain('import com.rnappauth.RNAppAuthModule');
    expect(out).toContain('import android.content.Intent');
    expect(out).toContain('RNAppAuthModule.stashAuthorizationResult(data)');
    expect(applyMainActivityPatch(out, 'kt')).toBe(out);
  });

  it('injects into an existing override', () => {
    const kt = `package com.example\n\nclass MainActivity : ReactActivity() {\n  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {\n    super.onActivityResult(requestCode, resultCode, data)\n  }\n}\n`;
    expect(applyMainActivityPatch(kt, 'kt')).toMatch(/onActivityResult\([^)]*\) \{\n\s+if \(requestCode == RNAppAuthModule/);
  });
});

describe('props', () => {
  it('derives schemes from redirectUrls (but not http/https)', () => {
    expect(getRedirectUrlScheme('com.example:/oauth')).toBe('com.example');
    expect(getRedirectUrlScheme('https://example.com/cb')).toBeUndefined();
    const p = resolveProps({ redirectUrls: ['com.example:/cb'], android: { appAuthRedirectScheme: 'override' } });
    expect(p.ios?.urlScheme).toBe('com.example');
    expect(p.android?.appAuthRedirectScheme).toBe('override');
  });
});
