import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";

import { pageLocalizer } from "./localize-page.ts";

/*
 * A Cloud page as its build writes it: English prerendered, translations as
 * templates after the footer (`contracts/hosted-web.md`).
 */
function cloudPage(body: string) {
  const window = new Window();
  window.document.write(`<!doctype html><html lang="en"><head>
    <title>About — Animama</title></head><body>${body}</body></html>`);
  return window.document as unknown as Document;
}

const translatedPage = `
  <a id="skip-link" href="#main" data-localized>Skip to content</a>
  <main id="main" data-localized><h1>About Animama</h1><button>Ask</button></main>
  <footer><div id="footer-links" data-localized><a href="/about/">About</a></div></footer>
  <template data-localizes="skip-link" lang="ja">本文へスキップ</template>
  <template data-localizes="main" lang="ja" data-title="概要 — Animama"><h1>Animama について</h1></template>
  <template data-localizes="footer-links" lang="ja"><a href="/about/">概要</a></template>
  <template data-localizes="main" lang="ko" data-title="소개 — Animama"><h1>Animama 소개</h1></template>`;

const text = (page: Document, selector: string) =>
  page.querySelector(selector)?.textContent?.trim();

test("a locale's templates replace the prerender, with the page's lang and title", () => {
  const page = cloudPage(translatedPage);
  const localize = pageLocalizer(page);
  localize("ja");
  assert.equal(page.documentElement.lang, "ja");
  assert.equal(page.title, "概要 — Animama");
  assert.equal(text(page, "main h1"), "Animama について");
  assert.equal(page.querySelector("main")?.lang, "ja");
  assert.equal(text(page, "#skip-link"), "本文へスキップ");
  assert.equal(text(page, "#footer-links"), "概要");
  // The templates stay for the next switch.
  assert.equal(page.querySelectorAll("template").length, 4);

  // A locale with only some templates: the rest show their English again.
  localize("ko");
  assert.equal(page.documentElement.lang, "ko");
  assert.equal(page.title, "소개 — Animama");
  assert.equal(text(page, "main h1"), "Animama 소개");
  assert.equal(text(page, "#skip-link"), "Skip to content");
  assert.equal(page.querySelector("#skip-link")?.hasAttribute("lang"), false);
  assert.equal(text(page, "#footer-links"), "About");
});

test("English restores the prerendered nodes themselves", () => {
  const page = cloudPage(translatedPage);
  const button = page.querySelector("main button");
  const localize = pageLocalizer(page);
  // An English visitor's page is left as it loaded.
  localize("en");
  assert.equal(page.querySelector("main button"), button);
  localize("ja");
  localize("en");
  assert.equal(page.documentElement.lang, "en");
  assert.equal(page.title, "About — Animama");
  assert.equal(page.querySelector("main button"), button);
  assert.equal(page.querySelector("main")?.hasAttribute("lang"), false);
});

test("an English-only page keeps its lang, and its note's template sets the title", () => {
  const page = cloudPage(`
    <div id="language-note" data-localized></div>
    <main id="main"><h1>Privacy Notice</h1></main>
    <template data-localizes="language-note" lang="ja" data-title="プライバシー通知 — Animama"><p>このページは英語版のみです。</p></template>`);
  const localize = pageLocalizer(page);
  localize("ja");
  assert.equal(page.documentElement.lang, "en");
  assert.equal(page.title, "プライバシー通知 — Animama");
  assert.equal(text(page, "main h1"), "Privacy Notice");
  assert.equal(text(page, "#language-note"), "このページは英語版のみです。");
  localize("en");
  assert.equal(text(page, "#language-note"), "");
  assert.equal(page.title, "About — Animama");
});
