import { useEffect, type ReactNode } from "react";
import type { i18n as I18nInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { applyDocumentLocale } from "./runtime";

/** Provide an Animama i18next instance and keep `<html lang>`/`dir` in step with it. */
export function AnimamaI18nProvider({
  i18n,
  children,
}: {
  i18n: I18nInstance;
  children: ReactNode;
}) {
  useEffect(() => {
    const apply = (language: string) => applyDocumentLocale(language);
    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => i18n.off("languageChanged", apply);
  }, [i18n]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
