import { createAnimamaI18n, type ActiveLocale } from "@animama/product-ui/i18n";

import {
  DEFAULT_NAMESPACE,
  NAMESPACES,
  SOURCE_CATALOGS,
  loadCatalog,
} from "./catalogs";
import { pseudoLocaleAvailable } from "./locale-preference";

/** Create the web application's i18next instance for an initial locale. */
export function createWebI18n(locale: ActiveLocale) {
  return createAnimamaI18n({
    locale,
    namespaces: NAMESPACES,
    defaultNamespace: DEFAULT_NAMESPACE,
    sourceCatalogs: SOURCE_CATALOGS,
    loadCatalog,
    pseudo: pseudoLocaleAvailable(),
  });
}
