module.exports = {
  root: true,
  env: { es2020: true, node: true, jest: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  globals: { fetch: 'readonly', __DEV__: 'readonly' },
  ignorePatterns: [
    'plugin/build/',
    'node_modules/',
    'android/',
    'ios/',
    'example/',
    '*.d.ts',
    'plugin/',
  ],
  rules: { 'no-unused-vars': 'warn' },
};
