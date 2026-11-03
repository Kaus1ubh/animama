import assert from "node:assert/strict";
import test from "node:test";

import { renderCrisisProtocol } from "./landing-stage-content.mjs";

test("the crisis protocol carries the app's machine translations for Cloud's Safety page", async () => {
  const protocol = JSON.parse(await renderCrisisProtocol());
  assert.deepEqual(Object.keys(protocol), [
    "schema_version",
    "html",
    "translations",
  ]);
  assert.equal(protocol.schema_version, 2);
  assert.deepEqual(Object.keys(protocol.translations), [
    "ja",
    "ko",
    "zh-Hans",
    "zh-Hant",
  ]);
  for (const html of [protocol.html, ...Object.values(protocol.translations)]) {
    assert.match(html, /^<h1>/);
    // Cloud publishes each inside a template, under a CSP without inline code.
    assert.doesNotMatch(html, /<script|<style|<\/?template|\sstyle=|\son\w+=/i);
  }
  // Each translation says it is one, right under its heading.
  for (const [locale, html] of Object.entries(protocol.translations))
    assert.match(html, /^<h1>[^<]+<\/h1>\n<p><em>[^<]+<\/em><\/p>/, locale);
});
