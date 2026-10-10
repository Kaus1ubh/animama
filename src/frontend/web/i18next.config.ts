import { defineConfig } from "i18next-cli";

/**
 * i18next-cli configuration for the web application's catalogs.
 *
 * Extraction keeps the English source catalogs in sync with the keys used in
 * code (`pnpm i18n:extract`; `--ci` fails when they drift) and generates typed
 * keys. Translated catalogs are maintained separately and checked by
 * `scripts/i18n-catalogs.mjs`, which reports missing beta keys without failing.
 */
export default defineConfig({
  locales: ["en"],
  extract: {
    input: ["src/**/*.{ts,tsx}"],
    ignore: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.d.ts",
      "src/routeTree.gen.ts",
      "src/test/**",
    ],
    output: "src/locales/{{language}}/{{namespace}}.json",
    primaryLanguage: "en",
    defaultNS: "common",
    functions: ["t", "*.t"],
    transComponents: ["Trans"],
    useTranslationNames: ["useTranslation"],
    sort: true,
    indentation: 2,
    removeUnusedKeys: true,
    // Backend codes are runtime values; `errors` keys are worded by code and
    // checked against lib/errors/userVisibleCodes.json instead.
    preservePatterns: ["errors:**"],
  },
  types: {
    input: ["src/locales/en/*.json"],
    output: "src/i18n/i18next.d.ts",
    resourcesFile: "src/i18n/resources.d.ts",
  },
});
