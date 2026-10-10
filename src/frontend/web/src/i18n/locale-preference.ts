import {
  PSEUDO_LOCALE,
  systemPreferredLanguages,
  type ActiveLocale,
} from "@animama/product-ui/i18n";
import {
  isUiLocale,
  resolveLocale,
  type UiLocale,
} from "@animama/runtime-contracts/locale";

/** Last locale this browser applied, used only to paint before App settings load. */
const APPLIED_LOCALE_KEY = "animama.ui-locale.applied";
/** Development switch for the pseudo-locale, set with `?ui-locale=pseudo` and cleared with `?ui-locale=off`. */
const PSEUDO_LOCALE_KEY = "animama.ui-locale.pseudo";

/** The pseudo-locale exists only in development builds and is never offered in the picker. */
export function pseudoLocaleAvailable(): boolean {
  return __ANIMAMA_DEV_BUILD__;
}

/** True while the development pseudo-locale is switched on for this tab. */
export function pseudoLocaleActive(): boolean {
  if (!pseudoLocaleAvailable() || typeof window === "undefined") return false;
  try {
    const requested = new URLSearchParams(window.location.search).get(
      "ui-locale",
    );
    if (requested === "pseudo")
      window.sessionStorage.setItem(PSEUDO_LOCALE_KEY, "1");
    if (requested === "off")
      window.sessionStorage.removeItem(PSEUDO_LOCALE_KEY);
    return window.sessionStorage.getItem(PSEUDO_LOCALE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember the locale just applied so the next launch paints in it immediately. */
export function rememberAppliedLocale(locale: UiLocale): void {
  try {
    window.localStorage.setItem(APPLIED_LOCALE_KEY, locale);
  } catch {
    // Storage can be unavailable (private windows); the next launch resolves again.
  }
}

function rememberedLocale(): UiLocale | null {
  try {
    const value = window.localStorage.getItem(APPLIED_LOCALE_KEY);
    return isUiLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Locale for the first paint, before App settings are available: the pseudo-locale
 * when requested in development, else the last applied locale, else the system.
 */
export function initialLocale(): ActiveLocale {
  if (pseudoLocaleActive()) return PSEUDO_LOCALE;
  return (
    rememberedLocale() ??
    resolveLocale({ preferred: systemPreferredLanguages() })
  );
}
