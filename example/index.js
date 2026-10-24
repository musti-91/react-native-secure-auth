/**
 * @format
 */

import React from 'react';
import {
  ActivityIndicator,
  AppRegistry,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppAuthProvider } from 'react-native-secure-auth';
import App from './App';
import { name as appName } from './app.json';

// Shown over the embedded web view ('webView' mode) until the login page has loaded.
const Loader = () => (
  <View style={styles.loader}>
    <ActivityIndicator size="large" />
    <Text style={styles.text}>Loading ...</Text>
  </View>
);

const Root = () => (
  <AppAuthProvider loader={<Loader />} backgroundColor="#ffffff">
    <App />
  </AppAuthProvider>
);

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { marginTop: 12, color: '#333' },
});

AppRegistry.registerComponent(appName, () => Root);
