// Typed translation keys for the web application. `resources.d.ts` is
// generated from the English catalogs by `pnpm i18n:extract`.
import type Resources from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    enableSelector: false;
    defaultNS: "common";
    resources: Resources;
  }
}
