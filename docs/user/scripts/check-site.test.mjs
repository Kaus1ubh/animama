import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkSite } from "./check-site.mjs";

function fixture(t) {
  const output = mkdtempSync(join(tmpdir(), "animama-docs-check-"));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const write = (path, content) => {
    const target = join(output, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const page = (content) =>
    `<html lang="en"><head><title>Guide</title></head><body><main>${content}</main><script src="/assets/app.fixture.js"></script></body></html>`;
  write("index.html", page('<a href="/desktop#requirements">Desktop</a>'));
  write("desktop.html", page('<h1 id="requirements">Desktop</h1>'));
  write("self-host.html", page('<a href="/">Overview</a>'));
  write("troubleshooting.html", page('<a href="/desktop">Desktop</a>'));
  write("404.html", page('<h1>Page not found</h1><a href="/">Overview</a>'));
  write("assets/app.fixture.js", "console.log('fixture');");
  return { output, write, page };
}

test("accepts the selected static pages and working local links", (t) => {
  const { output } = fixture(t);
  assert.equal(checkSite(output).pages, 5);
});

test("rejects accidental publication of source, plans or source maps", (t) => {
  const { output, write } = fixture(t);
  for (const path of [
    "plans/release.html",
    "README.md",
    "assets/app.fixture.js.map",
    "assets/raw-source.js",
  ]) {
    write(path, "private source");
    assert.throws(() => checkSite(output), /Unexpected publication file/);
    rmSync(join(output, path));
  }
});

test("rejects a symlink even when it has an allowed asset extension", (t) => {
  const { output } = fixture(t);
  symlinkSync(join(output, "index.html"), join(output, "assets/linked.js"));
  assert.throws(() => checkSite(output), /Symlink/);
});

test("rejects a missing page and a missing heading target", (t) => {
  const { output, write, page } = fixture(t);
  for (const href of ["/missing", "/desktop#missing-heading"]) {
    write("index.html", page(`<a href="${href}">Broken target</a>`));
    assert.throws(() => checkSite(output), /Broken internal link/);
  }
});

test("unavailable destinations cannot accidentally become active links", (t) => {
  const { output, write, page } = fixture(t);
  write(
    "index.html",
    page('<a href="https://animama.ai/download">Download</a>'),
  );
  assert.throws(
    () => checkSite(output, { home: false, download: false }),
    /Unverified external destination/,
  );
  assert.doesNotThrow(() => checkSite(output, { home: false, download: true }));
  write("index.html", page('<a href="/desktop">Coming soon</a>'));
  assert.throws(() => checkSite(output), /Coming soon.*active link/);
});

test("rejects remote runtime assets and executable link schemes", (t) => {
  const { output, write, page } = fixture(t);
  write(
    "index.html",
    page('<script src="https://tracker.example/runtime.js"></script>'),
  );
  assert.throws(() => checkSite(output), /External runtime asset/);
  write("index.html", page('<a href="javascript:alert(1)">Run</a>'));
  assert.throws(() => checkSite(output), /Unsupported link scheme/);
});

test("rejects a symlink at the publication root", (t) => {
  const { output } = fixture(t);
  const parent = mkdtempSync(join(tmpdir(), "animama-docs-root-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const linked = join(parent, "dist");
  symlinkSync(output, linked);
  assert.throws(() => checkSite(linked), /ordinary directory/);
});
