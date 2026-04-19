const requireAssetExists = require("./eslint-rules/require-asset-exists.js");
const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");

module.exports = defineConfig([
  // Expo base config (already flat)
  expoConfig,

  // Ignore build output
  {
    ignores: ["dist/*", "context/*"],
  },

  // Global plugins & rules
  {
    plugins: {
      custom: {
        rules: {
          "require-asset-exists": requireAssetExists,
        },
      },
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "custom/require-asset-exists": "error",
      "react/display-name": "off",
      "react/no-unescaped-entities": "warn",
      // Turn off the base rule as it can report incorrect errors
      "no-unused-vars": "off",
      // Use TypeScript-specific version which handles imports correctly
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Node/Metro-specific globals for metro.config.cjs
  {
    files: ["metro.config.cjs"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
  },
]);
