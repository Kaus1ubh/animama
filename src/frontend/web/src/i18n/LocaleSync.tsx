import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { systemPreferredLanguages } from "@animama/product-ui/i18n";
import { resolveLocale } from "@animama/runtime-contracts/locale";

import { useUserSettings } from "@/query/hooks/useUserSettings";
import { pseudoLocaleActive, rememberAppliedLocale } from "./locale-preference";

/** Bumps when the OS or browser language list changes, re-resolving "System default". */
function useSystemLanguages(): readonly string[] {
  const [languages, setLanguages] = useState(systemPreferredLanguages);
  useEffect(() => {
    const update = () => setLanguages(systemPreferredLanguages());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);
  return languages;
}

/**
 * Applies the owner's UI Locale once App settings load, and whenever the saved
 * preference or the system language changes. Switching keeps every mounted
 * screen and its state; only text and formatting update.
 */
export function LocaleSync() {
  const { i18n } = useTranslation();
  const { data: settings, isSuccess } = useUserSettings();
  const saved = settings?.locale ?? null;
  const preferred = useSystemLanguages();

  useEffect(() => {
    if (!isSuccess || pseudoLocaleActive()) return;
    const locale = resolveLocale({ saved, preferred });
    rememberAppliedLocale(locale);
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [i18n, isSuccess, preferred, saved]);

  return null;
}
