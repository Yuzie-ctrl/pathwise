module.exports = (api) => {
  api.cache(true);
  return {
    presets: [
      // Ensure NativeWind/CSS Interop runs after Expo preset (presets run last-to-first)
      'nativewind/babel',
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'nativewind',
          unstable_transformImportMeta: true,
        },
      ],
    ],
    plugins: ['react-native-reanimated/plugin'],
  };
};
