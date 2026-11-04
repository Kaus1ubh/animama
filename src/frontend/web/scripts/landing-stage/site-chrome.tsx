import "@fontsource-variable/dm-sans";
import "./site-chrome.css";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import { createLandingI18n, initialLocale } from "./i18n";
import { pageLocalizer } from "./localize-page";
import { SiteHeader, type SitePage } from "./site-header";

/*
 * The header on the pages Animama Cloud publishes beside the landing page.
 * Each page holds the build's prerendered header in `#site-header` (from
 * `site-chrome.json`), so it shows before this runs and without JavaScript.
 * This renders the same component over it to bring the menu, theme toggle and
 * pill highlight to life, in the visitor's language: the header carries its
 * own `lang`, and the pages' prerendered English swaps for the translations
 * they hold (`pageLocalizer`). For a visitor in another language, `theme.js`
 * hides the English prerender until this has replaced it (`site-header.css`).
 */
const root = document.getElementById("site-header");
if (root) {
  const current = ["about", "download"].includes(root.dataset.current ?? "")
    ? (root.dataset.current as SitePage)
    : undefined;
  void createLandingI18n(initialLocale())
    .then((i18n) => {
      const localizePage = pageLocalizer(document);
      flushSync(() =>
        createRoot(root).render(
          <I18nextProvider i18n={i18n}>
            <SiteHeader current={current} />
          </I18nextProvider>,
        ),
      );
      localizePage(i18n.language);
      i18n.on("languageChanged", localizePage);
    })
    .finally(() =>
      document.documentElement.removeAttribute("data-locale-pending"),
    );
}
