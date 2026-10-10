import { defineConfig } from "i18next-cli";

/**
 * i18next-cli configuration for the shared product UI's `product` namespace.
 * English (`src/locales/en.json`) is the source; translated locale files are
 * checked by `scripts/i18n-catalogs.mjs`.
 */
export default defineConfig({
  locales: ["en"],
  extract: {
    input: ["src/**/*.{ts,tsx}"],
    ignore: ["src/**/*.d.ts"],
    output: "src/locales/{{language}}.json",
    primaryLanguage: "en",
    defaultNS: "product",
    functions: ["t", "*.t"],
    transComponents: ["Trans"],
    useTranslationNames: ["useTranslation"],
    sort: true,
    indentation: 2,
    removeUnusedKeys: true,
  },
});
