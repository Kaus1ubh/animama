import { useContext } from "react";
import i18next, { type i18n as I18nInstance } from "i18next";
import { I18nContext, getI18n, useTranslation } from "react-i18next";

import {
  createAnimamaI18n,
  systemPreferredLanguages,
  type Catalog,
} from "@animama/product-ui/i18n";
import {
  SOURCE_LOCALE,
  isUiLocale,
  resolveLocale,
  type UiLocale,
} from "@animama/runtime-contracts/locale";

import englishEmotion from "../../src/locales/en/emotion.json";
import english from "./locales/en.json";
import { CLOSED_BETA } from "./stops";

/*
 * The site's words in the app's UI Locales, through the app's own i18next
 * setup (`createAnimamaI18n`). The landing copy is one namespace, `landing`,
 * kept in `locales/<tag>.json`; the Emotions stop also reads the app's
 * `emotion` namespace for its Reaction names. English is bundled; another
 * locale's catalogs load only when it is chosen.
 */

export const LANDING_NAMESPACE = "landing";
/** The namespaces the landing page reads; the header alone needs `landing`. */
export const PAGE_NAMESPACES = [LANDING_NAMESPACE, "emotion"] as const;

/** The visitor's choice, remembered for every page on the site (`theme.js`). */
const LOCALE_KEY = "landing-stage-locale";

const translated = import.meta.glob<Catalog>(
  ["./locales/*.json", "!./locales/en.json"],
  { import: "default" },
);
const translatedEmotion = import.meta.glob<Catalog>(
  ["../../src/locales/*/emotion.json", "!../../src/locales/en/emotion.json"],
  { import: "default" },
);

/** One namespace of a non-English locale; a missing file falls back to English. */
function loadCatalog(locale: UiLocale, namespace: string): Promise<Catalog> {
  const load =
    namespace === LANDING_NAMESPACE
      ? translated[`./locales/${locale}.json`]
      : translatedEmotion[`../../src/locales/${locale}/${namespace}.json`];
  return load ? load() : Promise.resolve({});
}

/** An i18next instance for the site in `locale`, with its catalogs loaded. */
export function createLandingI18n(
  locale: UiLocale,
  namespaces: readonly string[] = [LANDING_NAMESPACE],
): Promise<I18nInstance> {
  return createAnimamaI18n({
    locale,
    namespaces,
    defaultNamespace: LANDING_NAMESPACE,
    sourceCatalogs: { [LANDING_NAMESPACE]: english, emotion: englishEmotion },
    loadCatalog,
  });
}

/**
 * The locale to open in: the visitor's saved choice, else the first of their
 * browser's languages that is a UI Locale, else English. During the closed
 * beta, which hides the picker, the site is English only. `theme.js` makes
 * the same choice before first paint.
 */
export function initialLocale(): UiLocale {
  if (CLOSED_BETA) return SOURCE_LOCALE;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LOCALE_KEY);
  } catch {
    // Storage can be blocked; the browser's languages decide.
  }
  return resolveLocale({ saved, preferred: systemPreferredLanguages() });
}

function rememberLocale(locale: UiLocale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Private windows may refuse storage; the switch still applies.
  }
}

/** A dotted key of the English catalog that holds a string. */
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
export type LandingKey = Leaves<typeof english>;

/** Words a landing key in the active locale, filling `{{value}}` placeholders. */
export type LandingT = (
  key: LandingKey,
  values?: Record<string, string | number>,
) => string;

let englishInstance: I18nInstance | null = null;

/**
 * An English-only instance of the landing copy, for rendering without a
 * provider: the header prerendered for Animama Cloud's pages, and the page
 * text prerendered into `index.html`.
 */
function englishI18n(): I18nInstance {
  if (!englishInstance) {
    englishInstance = i18next.createInstance();
    void englishInstance.init({
      lng: SOURCE_LOCALE,
      fallbackLng: SOURCE_LOCALE,
      ns: [LANDING_NAMESPACE],
      defaultNS: LANDING_NAMESPACE,
      resources: { [SOURCE_LOCALE]: { [LANDING_NAMESPACE]: english } },
      initAsync: false,
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
  }
  return englishInstance;
}

/** The English landing copy, independent of any locale. */
export function englishT(): LandingT {
  return englishI18n().getFixedT(
    SOURCE_LOCALE,
    LANDING_NAMESPACE as never,
  ) as unknown as LandingT;
}

function hasLandingNamespace(
  i18n: I18nInstance | undefined,
): i18n is I18nInstance {
  const namespaces = i18n?.options?.ns;
  return Array.isArray(namespaces)
    ? namespaces.includes(LANDING_NAMESPACE)
    : namespaces === LANDING_NAMESPACE;
}

/**
 * The landing copy in the provided instance's locale (English when none is
 * provided), the locale itself, and `setLocale`, which switches every
 * mounted component live and remembers the choice in this browser.
 */
export function useLanding() {
  const context = useContext(I18nContext);
  const candidate = context?.i18n ?? getI18n();
  const { t, i18n } = useTranslation(LANDING_NAMESPACE as never, {
    i18n: hasLandingNamespace(candidate) ? candidate : englishI18n(),
  });
  const locale: UiLocale = isUiLocale(i18n.language)
    ? i18n.language
    : SOURCE_LOCALE;
  const setLocale = (next: UiLocale) => {
    rememberLocale(next);
    void i18n.changeLanguage(next);
  };
  return { t: t as unknown as LandingT, locale, setLocale };
}
