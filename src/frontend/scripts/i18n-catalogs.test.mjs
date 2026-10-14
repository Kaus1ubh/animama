import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  baseKey,
  checkCatalogs,
  compareCatalogs,
  placeholders,
} from "./i18n-catalogs.mjs";

const english = {
  greeting: "Hello {{name}}",
  colour: "Reset the {{label, lowercase}} colour",
  items_one: "{{count}} item",
  items_other: "{{count}} items",
  keywords: ["colour", "theme"],
};

test("placeholder names ignore format options", () => {
  assert.deepEqual(placeholders("Reset the {{label, lowercase}} {{ kind }}"), [
    "kind",
    "label",
  ]);
  assert.equal(baseKey("items_other"), "items");
});

test("a complete translation passes, including a locale with fewer plural forms", () => {
  const result = compareCatalogs(english, {
    greeting: "こんにちは {{name}}",
    colour: "{{label}} の色をリセット",
    items_other: "{{count}} 件",
    keywords: ["色", "テーマ"],
  });
  assert.deepEqual(result, {
    stale: [],
    placeholderMismatches: [],
    missing: [],
  });
});

test("missing and empty translations are reported, not errors", () => {
  const result = compareCatalogs(english, { greeting: "" });
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.placeholderMismatches, []);
  assert.deepEqual(result.missing.sort(), [
    "colour",
    "greeting",
    "items",
    "keywords",
  ]);
});

test("keys English no longer has and changed placeholders are errors", () => {
  const result = compareCatalogs(english, {
    greeting: "こんにちは {{user}}",
    removed: "古い",
  });
  assert.deepEqual(result.stale, ["removed"]);
  assert.deepEqual(result.placeholderMismatches, [
    { key: "greeting", unknown: ["user"], missing: ["name"] },
  ]);
});

test("the catalog check fails only on errors and reports missing beta keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "animama-i18n-"));
  try {
    const web = path.join(root, "web/src/locales");
    const product = path.join(root, "packages/product-ui/src/locales");
    const desktop = path.join(root, "desktop/src/locales");
    await mkdir(path.join(web, "en"), { recursive: true });
    await mkdir(path.join(web, "ja"), { recursive: true });
    await mkdir(path.join(product, "en"), { recursive: true });
    await mkdir(path.join(product, "ja"), { recursive: true });
    await mkdir(desktop, { recursive: true });
    await writeFile(path.join(desktop, "en.json"), "{}");
    await writeFile(path.join(desktop, "ja.json"), "{}");
    await writeFile(path.join(web, "en/common.json"), JSON.stringify(english));
    await writeFile(
      path.join(web, "ja/common.json"),
      JSON.stringify({ greeting: "こんにちは {{name}}" }),
    );
    await writeFile(path.join(product, "en/product.json"), "{}");
    await writeFile(path.join(product, "ja/product.json"), "{}");
    const passing = await checkCatalogs({ root });
    assert.deepEqual(passing.errors, []);
    assert.deepEqual(passing.report, ["web ja/common: 3 missing"]);

    await writeFile(
      path.join(web, "ja/common.json"),
      JSON.stringify({ stale: "x" }),
    );
    const failing = await checkCatalogs({ root });
    assert.deepEqual(failing.errors, [
      'web ja/common: "stale" is not in English',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop shell catalogs (one file per locale) get the same checks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "animama-i18n-"));
  try {
    for (const directory of [
      "web/src/locales/en",
      "packages/product-ui/src/locales/en",
    ])
      await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(
      path.join(root, "packages/product-ui/src/locales/en/product.json"),
      "{}",
    );
    const desktop = path.join(root, "desktop/src/locales");
    await mkdir(desktop, { recursive: true });
    await writeFile(
      path.join(desktop, "en.json"),
      JSON.stringify({ menu: { about: "About {{name}}", quit: "Quit" } }),
    );
    await writeFile(
      path.join(desktop, "ko.json"),
      JSON.stringify({ menu: { about: "{{name}}에 관하여" } }),
    );
    const passing = await checkCatalogs({ root, detailed: true });
    assert.deepEqual(passing.errors, []);
    assert.deepEqual(passing.report, [
      "desktop ko/shell: 1 missing",
      "  menu.quit",
    ]);

    await writeFile(
      path.join(desktop, "ko.json"),
      JSON.stringify({ menu: { about: "{{app}}에 관하여", help: "도움말" } }),
    );
    const failing = await checkCatalogs({ root });
    assert.deepEqual(failing.errors, [
      'desktop ko/shell: "menu.help" is not in English',
      'desktop ko/shell: "menu.about" placeholders differ from English (unknown: app) (missing: name)',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
