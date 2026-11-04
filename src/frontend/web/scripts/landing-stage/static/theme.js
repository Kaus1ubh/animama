// Before first paint (`index.html`, and Animama Cloud's pages): the visitor's
// saved theme, and whether the header waits for its words. Cloud's pages
// hold the header prerendered in English; for a visitor whose language is
// another, `site-chrome.tsx` rewords it, and `site-header.css` hides it
// until then (unless the header has no language picker, as in the closed
// beta). The language is chosen as `initialLocale` (`i18n.ts`) does: the
// saved choice, else the browser's first language that is a UI Locale
// (`SUPPORTED_LOCALES` in `@animama/runtime-contracts/locale`).
// A block, so its names stay out of the page's global scope.
{
  const root = document.documentElement;
  let saved = null;
  try {
    if (localStorage.getItem("landing-stage-theme") === "dark")
      root.classList.add("dark");
    saved = localStorage.getItem("landing-stage-locale");
  } catch {
    // Storage can be blocked; the page starts light, in the browser's language.
  }
  const tags = ["en", "ja", "ko", "zh-Hans", "zh-Hant"].includes(saved)
    ? [saved]
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
  const language = tags
    .map((tag) => String(tag).split(/[-_]/)[0].toLowerCase())
    .find((tag) => ["en", "ja", "ko", "zh"].includes(tag));
  if (language && language !== "en")
    root.setAttribute("data-locale-pending", "");
}
