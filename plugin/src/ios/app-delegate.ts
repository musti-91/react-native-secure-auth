import { ConfigPlugin, withAppDelegate } from '@expo/config-plugins';

const PROTOCOL = 'RNAppAuthAuthorizationFlowManager';
const PROPERTY = 'public weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?';

const OPEN_URL_BLOCK = `    if let flow = authorizationFlowManagerDelegate, flow.resumeExternalUserAgentFlow(with: url) {
      return true
    }`;
const USER_ACTIVITY_BLOCK = `    if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
      let webpageURL = userActivity.webpageURL,
      let flow = authorizationFlowManagerDelegate,
      flow.resumeExternalUserAgentFlow(with: webpageURL) {
      return true
    }`;

const OPEN_URL_METHOD = `
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
${OPEN_URL_BLOCK}
    return super.application(app, open: url, options: options)
  }
`;
const USER_ACTIVITY_METHOD = `
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
${USER_ACTIVITY_BLOCK}
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }
`;

const findClassBody = (contents: string) => {
  const m = /^\s*(?:@\w+\s+)*(?:public\s+|open\s+)?class\s+AppDelegate\s*:\s*([^{]*)\{/m.exec(contents);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < contents.length; i++) {
    if (contents[i] === '{') depth++;
    else if (contents[i] === '}' && --depth === 0) return { match: m, open, close: i };
  }
  return null;
};

export const applySwiftAppDelegatePatch = (input: string): string => {
  let contents = input;
  const cls = findClassBody(contents);
  if (!cls) throw new Error('react-native-secure-auth: could not find `class AppDelegate` in AppDelegate.swift');

  if (!cls.match[1].includes(PROTOCOL)) {
    const conformances = cls.match[1].replace(/\s*$/, '');
    const start = cls.match.index + cls.match[0].indexOf(cls.match[1]);
    contents = `${contents.slice(0, start)}${conformances}, ${PROTOCOL} ${contents.slice(start + cls.match[1].length)}`;
  }

  if (!/\bvar\s+authorizationFlowManagerDelegate\b/.test(contents)) {
    contents = contents.replace(/(class\s+AppDelegate\s*:[^{]*\{)/, `$1\n  ${PROPERTY}\n`);
  }

  const openUrlRe = /(func\s+application\s*\(\s*_\s+\w+\s*:\s*UIApplication\s*,\s*open\s+url\s*:\s*URL[\s\S]*?\)\s*->\s*Bool\s*\{)/;
  if (!/resumeExternalUserAgentFlow\(with:\s*url\)/.test(contents)) {
    contents = openUrlRe.test(contents)
      ? contents.replace(openUrlRe, `$1\n${OPEN_URL_BLOCK}`)
      : insertBeforeClassEnd(contents, OPEN_URL_METHOD);
  }

  const activityRe = /(func\s+application\s*\([\s\S]*?continue\s+userActivity\s*:\s*NSUserActivity[\s\S]*?\)\s*->\s*Bool\s*\{)/;
  if (!/resumeExternalUserAgentFlow\(with:\s*webpageURL\)/.test(contents)) {
    contents = activityRe.test(contents)
      ? contents.replace(activityRe, `$1\n${USER_ACTIVITY_BLOCK}`)
      : insertBeforeClassEnd(contents, USER_ACTIVITY_METHOD);
  }
  return contents;
};

const insertBeforeClassEnd = (contents: string, code: string) => {
  const cls = findClassBody(contents)!;
  return `${contents.slice(0, cls.close).replace(/\s*$/, '\n')}${code}${contents.slice(cls.close)}`;
};

/** Legacy Objective-C AppDelegate (pre-SDK 53). The header must declare the protocol + property. */
export const applyObjcAppDelegatePatch = (contents: string): string => {
  if (contents.includes('resumeExternalUserAgentFlowWithURL')) return contents;
  const re = /(-\s*\(BOOL\)\s*application:\s*\(UIApplication\s*\*\)\s*\w+\s+openURL:[\s\S]*?\{)/;
  if (!re.test(contents)) {
    throw new Error('react-native-secure-auth: could not find application:openURL:options: in AppDelegate');
  }
  return contents.replace(
    re,
    `$1\n  if ([self.authorizationFlowManagerDelegate resumeExternalUserAgentFlowWithURL:url]) {\n    return YES;\n  }\n`,
  );
};

export const withAppAuthAppDelegate: ConfigPlugin = config =>
  withAppDelegate(config, mod => {
    const { language } = mod.modResults;
    mod.modResults.contents =
      language === 'swift'
        ? applySwiftAppDelegatePatch(mod.modResults.contents)
        : applyObjcAppDelegatePatch(mod.modResults.contents);
    return mod;
  });
