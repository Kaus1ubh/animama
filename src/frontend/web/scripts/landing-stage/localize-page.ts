/**
 * Shows an Animama Cloud page in the header's locale. The page is
 * prerendered in English and holds its translations as inert
 * `<template data-localizes="<id>" lang="<locale>">` blocks
 * (`contracts/hosted-web.md`). For a locale, each template replaces the
 * content of the element with that `id`, which is marked `data-localized`,
 * and gives it the template's `lang`; a template's `data-title` sets the
 * page's title, and `main`'s sets the page's `lang`. An element without a
 * template in the locale (English, or a page that stays English) shows its
 * prerendered English again.
 *
 * Returns the function to call with each locale; it remembers the
 * prerendered English, title and `lang` of `page` as they were at creation.
 */
export function pageLocalizer(page: Document): (locale: string) => void {
  const pageTitle = page.title;
  const pageLang = page.documentElement.lang;
  const english = new Map<HTMLElement, Node[]>();
  const translated = new Set<HTMLElement>();
  return (locale) => {
    const templates = [
      ...page.querySelectorAll<HTMLTemplateElement>("template[data-localizes]"),
    ];
    let lang = pageLang;
    let title = pageTitle;
    for (const target of page.querySelectorAll<HTMLElement>(
      "[data-localized][id]",
    )) {
      const template = templates.find(
        (item) => item.dataset.localizes === target.id && item.lang === locale,
      );
      if (template) {
        if (!english.has(target)) english.set(target, [...target.childNodes]);
        target.replaceChildren(template.content.cloneNode(true));
        target.lang = locale;
        translated.add(target);
        title = template.dataset.title ?? title;
        if (target.localName === "main") lang = locale;
      } else if (translated.delete(target)) {
        // Only a translated element changes back, so English visitors keep
        // the page as it loaded (focus and selection included).
        target.replaceChildren(...(english.get(target) ?? []));
        target.removeAttribute("lang");
      }
    }
    page.documentElement.lang = lang;
    page.title = title;
  };
}
