import { defineConfig } from "i18next-cli";

import base from "./i18next.config";
import scope from "../../web/i18n-scope.json" with { type: "json" };

/** Raw-string lint for the shared product UI, with the web app's lint settings. */
export default defineConfig({
  ...base,
  lint: scope.lint as { acceptedTags: "all"; acceptedAttributes: string[] },
});
