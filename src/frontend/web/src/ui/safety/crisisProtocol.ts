import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// The canonical, public protocol document (companion-safety spec R7); English is
// authoritative and bundled. Machine translations load only for the active locale.
import englishProtocol from "../../../../../../docs/safety/crisis-protocol.md?raw";

const translatedProtocols = import.meta.glob<string>(
  "../../../../../../docs/safety/crisis-protocol.*.md",
  { query: "?raw", import: "default" },
);

/** The safety and crisis protocol in the active UI Locale, else English. */
export function useCrisisProtocol(): string {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [loaded, setLoaded] = useState<{ language: string; text: string }>();

  useEffect(() => {
    const load =
      translatedProtocols[
        `../../../../../../docs/safety/crisis-protocol.${language}.md`
      ];
    if (!load) return;
    let current = true;
    load().then(
      (text) => current && setLoaded({ language, text }),
      // A missing translation keeps the English protocol.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [language]);

  return loaded?.language === language ? loaded.text : englishProtocol;
}
