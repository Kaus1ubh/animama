import i18next, {
  type BackendModule,
  type i18n as I18nInstance,
  type ResourceLanguage,
} from "i18next";
import { initReactI18next } from "react-i18next";
import {
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  isUiLocale,
  type UiLocale,
} from "@animama/runtime-contracts/locale";
import productEnglish from "../locales/en/product.json";
import { PSEUDO_LOCALE, pseudoPostProcessor } from "./pseudo";

/** Namespace holding the shared product UI's own strings. */
export const PRODUCT_NAMESPACE = "product";

/** One namespace's catalog for one locale. */
export type Catalog = ResourceLanguage;

/** Loads an application namespace for a non-source locale, typically through `import()`. */
export type CatalogLoader = (
  locale: UiLocale,
  namespace: string,
) => Promise<Catalog>;

/** A UI Locale, or the development pseudo-locale. */
export type ActiveLocale = UiLocale | typeof PSEUDO_LOCALE;

/** Application catalogs and the initial locale for {@link createAnimamaI18n}. */
export interface AnimamaI18nOptions {
  readonly locale: ActiveLocale;
  /** Application namespaces; the product namespace is added automatically. */
  readonly namespaces: readonly string[];
  readonly defaultNamespace: string;
  /** English catalogs, bundled so the fallback never waits for the network. */
  readonly sourceCatalogs: Readonly<Record<string, Catalog>>;
  readonly loadCatalog: CatalogLoader;
  /** Enable the development pseudo-locale. */
  readonly pseudo?: boolean;
}

/** Load the product namespace for one locale; each locale is its own chunk. */
async function loadProductCatalog(locale: UiLocale): Promise<Catalog> {
  switch (locale) {
    case "en":
      return productEnglish;
    case "ja":
      return (await import("../locales/ja/product.json")).default;
    case "ko":
      return (await import("../locales/ko/product.json")).default;
    case "zh-Hans":
      return (await import("../locales/zh-Hans/product.json")).default;
    case "zh-Hant":
      return (await import("../locales/zh-Hant/product.json")).default;
  }
}

/**
 * Create an initialized i18next instance for one application.
 *
 * English catalogs are bundled; other locales load on demand, only for the
 * active locale. A missing key or a failed load falls back to English, and empty
 * strings count as missing so untranslated keys never render blank.
 */
export async function createAnimamaI18n(
  options: AnimamaI18nOptions,
): Promise<I18nInstance> {
  const instance = i18next.createInstance();
  const backend: BackendModule = {
    type: "backend",
    init() {},
    read(language, namespace, callback) {
      // The pseudo-locale transforms English text; other unknown tags have no catalog.
      const locale = language === PSEUDO_LOCALE ? SOURCE_LOCALE : language;
      if (!isUiLocale(locale)) return callback(null, {});
      if (locale === SOURCE_LOCALE)
        return callback(
          null,
          namespace === PRODUCT_NAMESPACE
            ? productEnglish
            : (options.sourceCatalogs[namespace] ?? {}),
        );
      const load =
        namespace === PRODUCT_NAMESPACE
          ? loadProductCatalog(locale)
          : options.loadCatalog(locale, namespace);
      load.then(
        (catalog) => callback(null, catalog),
        (error: unknown) =>
          callback(
            error instanceof Error ? error : new Error(String(error)),
            false,
          ),
      );
    },
  };
  instance.use(backend).use(initReactI18next);
  if (options.pseudo) instance.use(pseudoPostProcessor);
  await instance.init({
    lng: options.locale,
    fallbackLng: SOURCE_LOCALE,
    supportedLngs: options.pseudo
      ? [...SUPPORTED_LOCALES, PSEUDO_LOCALE]
      : [...SUPPORTED_LOCALES],
    load: "currentOnly",
    ns: [...options.namespaces, PRODUCT_NAMESPACE],
    defaultNS: options.defaultNamespace,
    resources: {
      [SOURCE_LOCALE]: {
        ...options.sourceCatalogs,
        [PRODUCT_NAMESPACE]: productEnglish,
      },
    },
    partialBundledLanguages: true,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    postProcess: options.pseudo ? ["pseudo"] : false,
  });
  // `{{label, lowercase}}` lets a language lowercase an interpolated label mid-sentence
  // (English "the primary colour") while others keep its capitalization.
  instance.services.formatter?.add(
    "lowercase",
    (value: unknown, language: string | undefined) =>
      String(value).toLocaleLowerCase(language),
  );
  return instance;
}

/** Text direction for a locale tag; all current UI Locales are left-to-right. */
export function localeDirection(locale: string): "ltr" | "rtl" {
  const language = locale.split(/[-_]/)[0]?.toLowerCase() ?? "";
  return ["ar", "fa", "he", "ur"].includes(language) ? "rtl" : "ltr";
}

/** Apply a locale to `<html lang>` and `<html dir>`. */
export function applyDocumentLocale(
  locale: string,
  root: HTMLElement = document.documentElement,
): void {
  root.lang = locale;
  root.dir = localeDirection(locale);
}
