import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { STAGE_AVATARS, STAGE_STOPS, stopClips } from "./stops.ts";
import { captionWords, continuesWord } from "./words.ts";

/*
 * The landing catalogs (`locales/<tag>.json`) beside the stops they word.
 * `pnpm i18n:check` already compares placeholders and stale keys; the
 * landing page also needs every locale complete, and its hero link words
 * present in each translated line.
 */

type Catalog = { [key: string]: string | Catalog };

const locales = new URL("./locales/", import.meta.url);
const catalogs = Object.fromEntries(
  readdirSync(locales)
    .filter((file) => file.endsWith(".json"))
    .map((file) => [
      file.slice(0, -".json".length),
      JSON.parse(readFileSync(new URL(file, locales), "utf8")) as Catalog,
    ]),
);
const english = catalogs.en;

function keys(catalog: Catalog, prefix = ""): string[] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : keys(value, `${prefix}${key}.`),
  );
}

function lookup(catalog: Catalog, key: string): string | undefined {
  let value: string | Catalog | undefined = catalog;
  for (const part of key.split(".")) {
    if (typeof value !== "object") return undefined;
    value = value[part];
  }
  return typeof value === "string" ? value : undefined;
}

test("every UI Locale has a complete landing catalog", () => {
  assert.deepEqual(Object.keys(catalogs).sort(), [
    "en",
    "ja",
    "ko",
    "zh-Hans",
    "zh-Hant",
  ]);
  for (const [locale, catalog] of Object.entries(catalogs))
    assert.deepEqual(keys(catalog).sort(), keys(english).sort(), locale);
});

test("each hero link word appears once in its locale's line", () => {
  const hero = STAGE_STOPS[0];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const body = lookup(catalog, `stops.${hero.id}.body`) ?? "";
    for (const stop of hero.links ?? []) {
      const word = lookup(catalog, `stops.${hero.id}.links.${stop}`) ?? "";
      assert.equal(body.split(word).length - 1, 1, `${locale}: ${word}`);
    }
  }
});

test("captions use only the voice tokens", () => {
  for (const [locale, catalog] of Object.entries(catalogs))
    for (const key of keys(catalog)) {
      // i18next's `{{placeholders}}` aside, single braces are `voice` tokens.
      const text = (lookup(catalog, key) ?? "").replace(/\{\{[^}]*\}\}/g, "");
      for (const token of text.match(/\{[^{}]+\}/g) ?? [])
        assert.match(
          token,
          /^\{(name|subject|object|possessive)\}$/i,
          `${locale} ${key}`,
        );
    }
});

test("the stops, chips and Avatars have their words", () => {
  for (const stop of STAGE_STOPS) {
    assert.ok(lookup(english, `stops.${stop.id}.title`), stop.id);
    for (const field of stop.beta ?? [])
      assert.ok(lookup(english, `stops.${stop.id}.beta.${field}`), stop.id);
    if (stop.panel !== "chips") continue;
    for (const avatar of STAGE_AVATARS)
      for (const clip of stopClips(stop, avatar.id))
        assert.ok(lookup(english, `clips.${clip.stem}`), clip.stem);
  }
  // Every Avatar has the same words as the first: pronouns, IDENTITY.md
  // lines, replies and notebook pages.
  const avatarKeys = (id: string) =>
    keys(english.avatars as Catalog, "")
      .filter((key) => key.startsWith(`${id}.`))
      .map((key) => key.slice(id.length + 1))
      .sort();
  for (const avatar of STAGE_AVATARS)
    assert.deepEqual(
      avatarKeys(avatar.id),
      avatarKeys(STAGE_AVATARS[0].id),
      avatar.id,
    );
});

test("spaced captions split at spaces", () => {
  assert.deepEqual(captionWords(" over 300, picked", "en"), [
    { text: "over", space: true },
    { text: "300,", space: true },
    { text: "picked", space: true },
  ]);
});

test("Japanese and Chinese captions split into words, keeping spaces and punctuation", () => {
  const words = captionWords("あなたの Anima に、「ミソ」。", "ja");
  assert.equal(
    words.map(({ text }) => text).join(""),
    "あなたのAnima に、「ミソ」。",
  );
  // Punctuation stays beside its word; an opening bracket joins the next.
  assert.ok(words.every(({ text }) => !/^[、。」]/.test(text)));
  assert.ok(words.some(({ text }) => text.startsWith("「")));
  assert.ok(
    captionWords("会动、会感受", "zh-Hans").every(({ space }) => !space),
  );
  // The space before an opening bracket stays with the word after it.
  assert.deepEqual(captionWords("你好 “Anima” 呀", "zh-Hans")[1], {
    text: "“Anima”",
    space: true,
  });
  // Japanese particles and verb endings stay with their word, across a
  // space, but not after a clause's punctuation.
  assert.deepEqual(
    captionWords("あなたの Anima に出会おう", "ja").map(({ text }) => text),
    ["あなたの", "Anima に", "出会おう"],
  );
  assert.ok(continuesWord({ text: "を", space: false }, "リアクション", "ja"));
  assert.ok(!continuesWord({ text: "を", space: false }, "から、", "ja"));
  assert.ok(!continuesWord({ text: "使い", space: false }, "を", "ja"));
});
