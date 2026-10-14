import { defineConfig } from "i18next-cli";

import base from "./i18next.config";
import scope from "./i18n-scope.json" with { type: "json" };

/**
 * Raw-string lint for all application code. `exempt` lists developer and debug
 * tools that stay English; `lint` is shared with the check's fixture tests.
 */
export default defineConfig({
  ...base,
  extract: {
    ...base.extract,
    ignore: [
      ...(base.extract.ignore as string[]),
      "src/**/*.test.{ts,tsx}",
      ...scope.exempt,
    ],
  },
  // Every element, including components such as SettingsRow and SelectItem,
  // and the user-visible attributes listed in i18n-scope.json.
  lint: scope.lint as { acceptedTags: "all"; acceptedAttributes: string[] },
});
