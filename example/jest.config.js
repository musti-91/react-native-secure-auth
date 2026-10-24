const path = require('path');

module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^react-native-secure-auth$': path.resolve(__dirname, '..', 'index.js'),
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
};
