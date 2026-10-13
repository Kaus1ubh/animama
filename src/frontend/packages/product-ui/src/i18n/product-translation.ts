import { useContext } from "react";
import i18next, { type i18n as I18nInstance, type TFunction } from "i18next";
import { I18nContext, getI18n, useTranslation } from "react-i18next";
import productEnglish from "../locales/en/product.json";
import { PRODUCT_NAMESPACE } from "./runtime";

let englishInstance: I18nInstance | null = null;

/**
 * An English-only instance holding the product namespace. Hosts that render
 * product UI without an Animama i18n provider get English, and code outside
 * React uses it for English text kept for hosts and logs.
 */
export function productEnglishI18n(): I18nInstance {
  if (!englishInstance) {
    englishInstance = i18next.createInstance();
    void englishInstance.init({
      lng: "en",
      fallbackLng: "en",
      ns: [PRODUCT_NAMESPACE],
      defaultNS: PRODUCT_NAMESPACE,
      resources: { en: { [PRODUCT_NAMESPACE]: productEnglish } },
      initAsync: false,
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
  }
  return englishInstance;
}

/** A translator for English product text, independent of the active locale. */
export function productEnglishT(): TFunction<"product"> {
  return productEnglishI18n().getFixedT("en", PRODUCT_NAMESPACE);
}

/** True when an instance was set up with the product namespace (`createAnimamaI18n`). */
function hasProductNamespace(
  i18n: I18nInstance | undefined,
): i18n is I18nInstance {
  const namespaces = i18n?.options?.ns;
  return Array.isArray(namespaces)
    ? namespaces.includes(PRODUCT_NAMESPACE)
    : namespaces === PRODUCT_NAMESPACE;
}

/**
 * `useTranslation` for the product namespace: the application's instance when
 * one is provided (or registered) with the product namespace, otherwise
 * English, so a host's own i18next instance never shows raw product keys.
 */
export function useProductTranslation() {
  const context = useContext(I18nContext);
  const candidate = context?.i18n ?? getI18n();
  return useTranslation(PRODUCT_NAMESPACE, {
    i18n: hasProductNamespace(candidate) ? candidate : productEnglishI18n(),
  });
}
