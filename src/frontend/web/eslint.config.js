import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

import i18nScope from "./i18n-scope.json" with { type: "json" };

/** Toast text must come from the catalogs in converted UI (`i18next-cli lint` covers JSX). */
const RAW_TOAST_TEXT = ["Literal", "TemplateLiteral"].flatMap((type) => [
  {
    selector: `CallExpression[callee.name="toast"][arguments.0.type="${type}"]`,
    message: "Use a catalog string (t()) for toast text.",
  },
  {
    selector: `CallExpression[callee.object.name="toast"][arguments.0.type="${type}"]`,
    message: "Use a catalog string (t()) for toast text.",
  },
]);

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-hosted",
    "src/**/*.d.ts",
    "src/routeTree.gen.ts",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-refresh/only-export-components": "off",
      "preserve-caught-error": "off",
      "no-useless-assignment": "off",
    },
  },
  {
    files: i18nScope.converted,
    ignores: i18nScope.exempt,
    rules: {
      "no-restricted-syntax": ["error", ...RAW_TOAST_TEXT],
    },
  },
]);
