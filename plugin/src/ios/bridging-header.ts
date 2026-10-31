import * as fs from 'fs';
import * as path from 'path';
import { ConfigPlugin, withXcodeProject } from '@expo/config-plugins';

const SETTING = 'SWIFT_OBJC_BRIDGING_HEADER';
const IMPORT = '#import <react-native-secure-auth/RNAppAuthAuthorizationFlowManager.h>';
const IMPORT_RE =
  /#import\s+[<"](?:react-native-secure-auth\/)?RNAppAuthAuthorizationFlowManager\.h[>"]/;

export const ensureBridgingHeaderImport = (contents: string): string =>
  IMPORT_RE.test(contents)
    ? contents
    : `${contents.replace(/\s*$/, '')}${contents.trim() ? '\n' : ''}${IMPORT}\n`;

const unquote = (v: string) => v.replace(/^"|"$/g, '');

export const withBridgingHeader: ConfigPlugin = (config) =>
  withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const iosRoot = mod.modRequest.platformProjectRoot;
    const projectName = mod.modRequest.projectName || 'App';
    const target = project.getFirstTarget();
    const listId = target.firstTarget.buildConfigurationList;
    const lists = project.pbxXCConfigurationList()[listId];
    const configs = project.pbxXCBuildConfigurationSection();

    const headers = new Set<string>();
    const defaultRel = `${projectName}/${projectName}-Bridging-Header.h`;
    for (const { value } of lists.buildConfigurations) {
      const settings = configs[value].buildSettings;
      let rel = settings[SETTING] ? unquote(String(settings[SETTING])) : '';
      if (!rel) {
        rel = defaultRel;
        settings[SETTING] = `"${rel}"`;
      }
      rel = rel
        .replace(/\$\((SRCROOT|PROJECT_DIR)\)\/?/g, '')
        .replace(/\$\((TARGET_NAME|PROJECT_NAME)\)/g, projectName);
      headers.add(path.resolve(iosRoot, rel));
    }
    for (const file of headers) {
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, ensureBridgingHeaderImport(existing));
    }
    return mod;
  });
