const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');
const escape = p => p.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * Resolves `react-native-secure-auth` to the library at the repository root while making sure
 * react / react-native always come from this app's node_modules.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    blockList: [new RegExp(`^${escape(path.join(root, 'node_modules'))}\\/.*$`)],
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    extraNodeModules: {
      'react-native-secure-auth': root,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
