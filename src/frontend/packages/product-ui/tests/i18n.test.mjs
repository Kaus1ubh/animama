import assert from "node:assert/strict";
import test from "node:test";
import {
  PSEUDO_CLOSE,
  PSEUDO_LOCALE,
  PSEUDO_OPEN,
  applyDocumentLocale,
  createAnimamaI18n,
  createFormatters,
  localeDirection,
  pseudoLocalize,
} from "../dist/i18n.js";

const english = {
  common: {
    greeting: "Hello {{name}}",
    untranslated: "English only",
    items_one: "{{count}} item",
    items_other: "{{count}} items",
    colour: "Reset the {{label, lowercase}} colour",
  },
};
const catalogs = {
  ja: {
    common: {
      greeting: "こんにちは {{name}}",
      untranslated: "",
      items_other: "{{count}} 件",
    },
  },
  ko: {
    common: { greeting: "안녕하세요 {{name}}", items_other: "{{count}}개" },
  },
  "zh-Hans": { common: { items_other: "{{count}} 项" } },
  "zh-Hant": { common: { items_other: "{{count}} 項" } },
};

function options(locale, loads, overrides = {}) {
  return {
    locale,
    namespaces: ["common"],
    defaultNamespace: "common",
    sourceCatalogs: english,
    loadCatalog: async (tag, namespace) => {
      loads.push(`${tag}/${namespace}`);
      return catalogs[tag]?.[namespace] ?? {};
    },
    ...overrides,
  };
}

test("only the active locale loads, and missing or empty keys fall back to English", async () => {
  const loads = [];
  const i18n = await createAnimamaI18n(options("ja", loads));
  assert.equal(i18n.t("greeting", { name: "Annie" }), "こんにちは Annie");
  assert.equal(i18n.t("untranslated"), "English only");
  assert.equal(i18n.t("no.such.key"), "no.such.key");
  assert.deepEqual(loads, ["ja/common"]);
});

test("switching locales loads the new catalog before announcing the change", async () => {
  const loads = [];
  const i18n = await createAnimamaI18n(options("en", loads));
  assert.deepEqual(loads, []);
  const announced = [];
  i18n.on("languageChanged", (language) =>
    announced.push([language, i18n.t("greeting", { name: "Annie" })]),
  );
  await i18n.changeLanguage("ko");
  assert.deepEqual(loads, ["ko/common"]);
  assert.deepEqual(announced, [["ko", "안녕하세요 Annie"]]);
});

test("a catalog can lowercase an interpolated label", async () => {
  const i18n = await createAnimamaI18n(options("en", []));
  assert.equal(
    i18n.t("colour", { label: "Primary" }),
    "Reset the primary colour",
  );
});

test("a failed catalog load keeps English text", async () => {
  const i18n = await createAnimamaI18n(
    options("zh-Hant", [], {
      loadCatalog: async () => {
        throw new Error("offline");
      },
    }),
  );
  assert.equal(i18n.t("greeting", { name: "Annie" }), "Hello Annie");
});

test("plurals follow each locale's plural rules", async () => {
  const en = await createAnimamaI18n(options("en", []));
  assert.equal(en.t("items", { count: 1 }), "1 item");
  assert.equal(en.t("items", { count: 2 }), "2 items");
  for (const [locale, one, many] of [
    ["ja", "1 件", "2 件"],
    ["ko", "1개", "2개"],
    ["zh-Hans", "1 项", "2 项"],
    ["zh-Hant", "1 項", "2 項"],
  ]) {
    const i18n = await createAnimamaI18n(options(locale, []));
    assert.equal(i18n.t("items", { count: 1 }), one, locale);
    assert.equal(i18n.t("items", { count: 2 }), many, locale);
  }
});

test("the pseudo-locale marks translated text and leaves markup intact", async () => {
  const pseudo = await createAnimamaI18n(
    options(PSEUDO_LOCALE, [], { pseudo: true }),
  );
  const text = pseudo.t("greeting", { name: "Ann" });
  assert.ok(text.startsWith(`${PSEUDO_OPEN}Ĥéĺĺó Áññ`), text);
  assert.ok(text.endsWith(PSEUDO_CLOSE), text);
  assert.equal(pseudoLocalize("Save <1>now</1>").includes("<1>"), true);
  const english = await createAnimamaI18n(options("en", [], { pseudo: true }));
  assert.equal(english.t("greeting", { name: "Ann" }), "Hello Ann");
});

test("formatters follow the formatting locale", () => {
  const when = Date.UTC(2026, 9, 10, 15, 4);
  const utc = { timeZone: "UTC" };
  // [locale, long date, short time, number, yesterday, list]
  const cases = [
    [
      "en-US",
      "October 10, 2026",
      "3:04 PM",
      "1,234,567.5",
      "yesterday",
      "Annie, Caitlyn, and Mika",
    ],
    [
      "en-GB",
      "10 October 2026",
      "15:04",
      "1,234,567.5",
      "yesterday",
      "Annie, Caitlyn and Mika",
    ],
    [
      "ja",
      "2026年10月10日",
      "15:04",
      "1,234,567.5",
      "昨日",
      "Annie、Caitlyn、Mika",
    ],
    [
      "ko",
      "2026년 10월 10일",
      "PM 3:04",
      "1,234,567.5",
      "어제",
      "Annie, Caitlyn 및 Mika",
    ],
    [
      "zh-Hans",
      "2026年10月10日",
      "15:04",
      "1,234,567.5",
      "昨天",
      "Annie、Caitlyn和Mika",
    ],
    [
      "zh-Hant",
      "2026年10月10日",
      "下午3:04",
      "1,234,567.5",
      "昨天",
      "Annie、Caitlyn和Mika",
    ],
  ];
  for (const [locale, date, time, number, yesterday, list] of cases) {
    const format = createFormatters(locale);
    assert.equal(
      format.date(when, { dateStyle: "long", ...utc }),
      date,
      locale,
    );
    assert.equal(
      format.time(when, { timeStyle: "short", ...utc }),
      time,
      locale,
    );
    assert.equal(format.number(1234567.5), number, locale);
    assert.equal(format.relative(-1, "day"), yesterday, locale);
    assert.equal(format.list(["Annie", "Caitlyn", "Mika"]), list, locale);
  }
  assert.equal(
    createFormatters("en-US").date(when, { dateStyle: "short", ...utc }),
    "10/10/26",
  );
  assert.equal(
    createFormatters("en-GB").date(when, { dateStyle: "short", ...utc }),
    "10/10/2026",
  );
  assert.equal(createFormatters("en").fileSize(100), "1 kB");
  assert.equal(createFormatters("en").fileSize(1536), "2 kB");
  assert.equal(createFormatters("en").fileSize(5.25 * 1024 ** 2), "5.3 MB");
  assert.equal(createFormatters("en").fileSize(3 * 1024 ** 3), "3 GB");
  assert.ok(createFormatters("ja").compare("あ", "い") < 0);
});

test("the document root takes the locale's lang and direction", () => {
  const root = { lang: "en", dir: "ltr" };
  applyDocumentLocale("zh-Hant", root);
  assert.deepEqual(root, { lang: "zh-Hant", dir: "ltr" });
  applyDocumentLocale("ar", root);
  assert.deepEqual(root, { lang: "ar", dir: "rtl" });
});

test("current UI Locales are left-to-right", () => {
  for (const tag of ["en", "ja", "ko", "zh-Hans", "zh-Hant", PSEUDO_LOCALE])
    assert.equal(localeDirection(tag), "ltr", tag);
  assert.equal(localeDirection("ar-EG"), "rtl");
});

test("chat failures keep English text and render their copy in the active locale", async () => {
  const { chatFailureCopy, describeChatFailure } =
    await import("../dist/chat.js");
  const failure = describeChatFailure(
    {
      code: "openai_connection_error",
      details: {
        connection_name: "Home Ollama",
        connection_preset: "ollama",
        connection_base_url: "http://127.0.0.1:11434/v1",
      },
    },
    "hello",
  );
  assert.equal(failure.title, "Animama couldn't reach Home Ollama.");
  const i18n = await createAnimamaI18n(options("ja", []));
  const t = i18n.getFixedT("ja", "product");
  const title = chatFailureCopy(t, failure.copy.title);
  const guidance = chatFailureCopy(t, failure.copy.guidance);
  assert.ok(
    title.includes("Home Ollama") && !title.includes("couldn't"),
    title,
  );
  assert.ok(guidance.includes("http://127.0.0.1:11434/v1"), guidance);
  const unnamed = describeChatFailure({ code: "openai_rate_limit" }, "hi");
  assert.equal(
    unnamed.title,
    "The model server is receiving too many requests.",
  );
  assert.ok(
    chatFailureCopy(t, unnamed.copy.title).startsWith(
      t("chatFailure.defaultConnection"),
    ),
  );
});
