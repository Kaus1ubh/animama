// Fixture tests for the `i18n:check` CLI steps: the raw-string lint and the
// English catalog sync (`extract --ci --dry-run`) must fail on the problems
// they guard against, and pass on a clean source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(frontendRoot, "node_modules/.bin/i18next-cli");
// The real lint settings, so the fixtures fail if the shipped check weakens.
const { lint } = JSON.parse(
  await readFile(path.join(frontendRoot, "web/i18n-scope.json"), "utf8"),
);

const CONFIG = `export default {
  locales: ["en"],
  extract: {
    input: ["src/**/*.tsx"],
    output: "locales/{{language}}/{{namespace}}.json",
    primaryLanguage: "en",
    defaultNS: "common",
    functions: ["t"],
    useTranslationNames: ["useTranslation"],
    sort: true,
    indentation: 2,
    removeUnusedKeys: true,
  },
  lint: ${JSON.stringify(lint)},
};
`;

const CLEAN_SOURCE = `import { useTranslation } from "react-i18next";
import { SettingsRow } from "./SettingsRow";
export function Example() {
  const { t } = useTranslation();
  return <SettingsRow label={t("title")} description={t("detail")} />;
}
`;

async function fixture({
  source = CLEAN_SOURCE,
  english = { detail: "Detail", title: "Title" },
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "animama-i18n-check-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "locales/en"), { recursive: true });
  await writeFile(path.join(root, "i18next.config.mjs"), CONFIG);
  await writeFile(path.join(root, "src/Example.tsx"), source);
  await writeFile(
    path.join(root, "locales/en/common.json"),
    `${JSON.stringify(english, null, 2)}\n`,
  );
  return root;
}

function run(root, ...args) {
  const result = spawnSync(cli, [...args, "-c", "i18next.config.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("a clean source passes the lint and catalog sync without writing files", async () => {
  const root = await fixture();
  try {
    assert.equal(run(root, "lint").status, 0);
    const before = await readFile(
      path.join(root, "locales/en/common.json"),
      "utf8",
    );
    assert.equal(run(root, "extract", "--ci", "--dry-run").status, 0);
    assert.equal(
      await readFile(path.join(root, "locales/en/common.json"), "utf8"),
      before,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("raw text in a custom component's children or label fails the lint", async () => {
  for (const source of [
    `import { Row } from "./Row";\nexport const A = () => <Row>Raw words here</Row>;\n`,
    `import { Row } from "./Row";\nexport const B = () => <Row label="Raw label text" />;\n`,
  ]) {
    const root = await fixture({ source, english: {} });
    try {
      assert.notEqual(run(root, "lint").status, 0, source);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("a key used in code but missing from English fails the catalog sync", async () => {
  const root = await fixture({ english: { title: "Title" } });
  try {
    assert.notEqual(run(root, "extract", "--ci", "--dry-run").status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an English key no code uses fails the catalog sync", async () => {
  const root = await fixture({
    english: { detail: "Detail", title: "Title", unused: "Unused" },
  });
  try {
    assert.notEqual(run(root, "extract", "--ci", "--dry-run").status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the shared product UI has no literal toast text", async () => {
  // product-ui has no ESLint step, so this mirrors web's toast rule.
  const { readdir } = await import("node:fs/promises");
  const root = path.join(frontendRoot, "packages/product-ui/src");
  const offenders = [];
  for (const entry of await readdir(root, { recursive: true })) {
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\./.test(entry)) continue;
    const source = await readFile(path.join(root, entry), "utf8");
    if (/\btoast(?:\.\w+)?\(\s*["'`]/.test(source)) offenders.push(entry);
  }
  assert.deepEqual(offenders, []);
});
