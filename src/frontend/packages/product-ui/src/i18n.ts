/** UI Locale runtime shared by Animama applications: i18next setup, provider and formatters. */
export {
  PRODUCT_NAMESPACE,
  applyDocumentLocale,
  createAnimamaI18n,
  localeDirection,
  type ActiveLocale,
  type AnimamaI18nOptions,
  type Catalog,
  type CatalogLoader,
} from "./i18n/runtime";
export { AnimamaI18nProvider } from "./i18n/provider";
export {
  createFormatters,
  systemPreferredLanguages,
  useFormatters,
  type LocaleFormatters,
} from "./i18n/format";
export {
  PSEUDO_CLOSE,
  PSEUDO_LOCALE,
  PSEUDO_OPEN,
  pseudoLocalize,
} from "./i18n/pseudo";
