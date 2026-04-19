import type { ConfigContext, ExpoConfig } from '@expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Your App Name',
  slug: 'your-app-slug',
  newArchEnabled: true,
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  scheme: 'yourapp',
  runtimeVersion: {
    policy: 'appVersion',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
    supportsTablet: true,
    bundleIdentifier: 'com.yourcompany.yourapp',
  },
  android: {
    package: 'com.yourcompany.yourapp',
  },
  plugins: [
    'expo-router',
    'expo-font',
    ...(process.env.EXPO_PLATFORM === 'native'
      ? [
          ['expo-dev-client', { launchMode: 'most-recent' }],
          'react-native-maps',
        ]
      : []),
  ] as NonNullable<ExpoConfig['plugins']>,
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: '',
    },
  },
  owner: '*',
});
