import "@fontsource-variable/dm-sans";
import "./site-chrome.css";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import { createLandingI18n, initialLocale } from "./i18n";
import { SiteHeader, type SitePage } from "./site-header";

/*
 * The header on the pages Animama Cloud publishes beside the landing page.
 * Each page holds the build's prerendered header in `#site-header` (from
 * `site-chrome.json`), so it shows before this runs and without JavaScript.
 * This renders the same component over it to bring the menu, theme toggle and
 * pill highlight to life, in the visitor's language: the header carries its
 * own `lang`, and the pages' prerendered English swaps for the translations
 * they hold (`localizePage`). For a visitor in another language, `theme.js`
 * hides the English prerender until this has replaced it (`site-header.css`).
 */
const root = document.getElementById("site-header");
if (root) {
  const current = ["about", "download"].includes(root.dataset.current ?? "")
    ? (root.dataset.current as SitePage)
    : undefined;
  void createLandingI18n(initialLocale())
    .then((i18n) => {
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

const pageTitle = document.title;
const pageLang = document.documentElement.lang;
/** Each localized element's prerendered English, kept to switch back to. */
const englishContent = new Map<HTMLElement, Node[]>();

/**
 * Shows a Cloud page in `locale`. The page holds its translations as inert
 * `<template data-localizes="<id>" lang="<locale>">` blocks; each replaces
 * the content of the element with that `id`, which is marked
 * `data-localized`, and takes its `lang`. `main`'s template also sets the
 * page's `lang` and, from `data-title`, its title. An element without a
 * template in `locale` (English, or a page that stays English) shows its
 * prerendered English.
 */
function localizePage(locale: string) {
  const templates = [
    ...document.querySelectorAll<HTMLTemplateElement>(
      "template[data-localizes]",
    ),
  ];
  let lang = pageLang;
  let title = pageTitle;
  for (const target of document.querySelectorAll<HTMLElement>(
    "[data-localized][id]",
  )) {
    if (!englishContent.has(target))
      englishContent.set(target, [...target.childNodes]);
    const template = templates.find(
      (item) => item.dataset.localizes === target.id && item.lang === locale,
    );
    if (template) {
      target.replaceChildren(template.content.cloneNode(true));
      target.lang = locale;
    } else {
      target.replaceChildren(...(englishContent.get(target) ?? []));
      target.removeAttribute("lang");
    }
    if (template && target.localName === "main") {
      lang = locale;
      title = template.dataset.title ?? pageTitle;
    }
  }
  document.documentElement.lang = lang;
  document.title = title;
}
