import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createPackage } from "@electron/asar";
import { sha256 } from "../scripts/runtime/common.mjs";
import { writeArtifactIndex } from "../scripts/runtime/release-artifacts.mjs";
import {
  gitleaksFindings,
  scanCandidate,
  searchNeedles,
  writePrintableRuns,
} from "../scripts/runtime/release-scan.mjs";

const roots = [];
function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), "animama-release-scan-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

/**
 * A stand-in scanner with Gitleaks' CLI shape: flags FAKE-LEAK lines and tokens
 * matching the github-pat rule, and honors --exit-code for leaks.
 */
function fakeGitleaks(
  root,
  { detectCanary = true, version = "8.30.1", crash = false } = {},
) {
  const file = path.join(root, "gitleaks");
  writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "version") { console.log(${JSON.stringify(version)}); process.exit(0); }
if (${crash}) process.exit(1);
const report = args[args.indexOf("--report-path") + 1];
const leaksExit = Number(args[args.indexOf("--exit-code") + 1]);
const target = args[args.length - 1];
const findings = [];
const walk = (dir) => { for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir, name);
  if (fs.lstatSync(file).isDirectory()) { walk(file); continue; }
  const text = fs.readFileSync(file, "utf8");
  // Like Gitleaks, silently skip files that begin with a known binary format.
  if (text.startsWith("SQLite format 3")) continue;
  text.split("\\n").forEach((line, index) => {
    if (line.includes("FAKE-LEAK")) findings.push({ RuleID: "generic-api-key", File: file, StartLine: index + 1, Secret: "FAKE-LEAK", Match: line });
    if (${detectCanary} && /ghp_[0-9A-Za-z]{36}\\b/.test(line)) findings.push({ RuleID: "github-pat", File: file, StartLine: index + 1, Secret: line, Match: line });
  });
} };
walk(target);
fs.writeFileSync(report, JSON.stringify(findings));
process.exit(findings.length ? leaksExit : 0);
`,
  );
  chmodSync(file, 0o755);
  return file;
}

function candidate(root, files) {
  const directory = path.join(root, "publish");
  mkdirSync(directory);
  for (const [name, content] of Object.entries(files))
    writeFileSync(path.join(directory, name), content);
  writeArtifactIndex(directory, "0.1.0", Object.keys(files));
  return directory;
}

/** Build a zstd tar pack; `fill` writes arbitrary members into its source tree. */
function tarZst(root, fill) {
  const source = mkdtempSync(path.join(root, "pack-src-"));
  fill(source);
  const tar = `${source}.tar`;
  expect(spawnSync("tar", ["-cf", tar, "-C", source, "."]).status).toBe(0);
  return zstdCompressSync(readFileSync(tar));
}

const PACK = "parakeet-stt-0.1.0-data-only.tar.zst";
const IN_PACK = `${PACK}.expanded`;
const home = [{ label: "home-directory", value: "/Users/someone/" }];

async function scan(root, directory, options = {}) {
  return scanCandidate({
    directory,
    gitleaks: fakeGitleaks(root, options),
    needles: options.needles ?? home,
    workRoot: root,
  });
}

describe("release candidate scan", () => {
  it("finds a needle split across read chunks without recording its value", async () => {
    const root = scratch();
    const file = path.join(root, "blob.bin");
    const needle = "/Users/someone/";
    // The needle starts five bytes before the first chunk boundary.
    writeFileSync(
      file,
      Buffer.concat([
        Buffer.alloc(64 * 1024 - 5, 0x61),
        Buffer.from(needle),
        Buffer.from("tail"),
      ]),
    );
    expect(
      await searchNeedles(file, [{ label: "home-directory", value: needle }], {
        chunkBytes: 64 * 1024,
      }),
    ).toEqual(["home-directory"]);
    expect(await searchNeedles(file, [])).toEqual([]);
  });

  it("extracts printable runs from binary data like strings(1)", async () => {
    const root = scratch();
    const file = path.join(root, "blob.bin");
    writeFileSync(
      file,
      Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from("short\0"),
        Buffer.from("long enough run\0\xff"),
        Buffer.from("tail string"),
      ]),
    );
    await writePrintableRuns(file, path.join(root, "out.txt"));
    expect(readFileSync(path.join(root, "out.txt"), "utf8")).toBe(
      "long enough run\ntail string",
    );
  });

  it("maps scanner findings to candidate locations without secret values", () => {
    const findings = gitleaksFindings(
      [
        {
          RuleID: "generic-api-key",
          File: "/scan/work/view/0.txt",
          StartLine: 4,
          Secret: "value",
          Match: "key=value",
        },
      ],
      [{ artifact: "Animama-0.1.0-arm64.zip", path: "x.js", view: "text" }],
    );
    expect(findings).toEqual([
      {
        source: "gitleaks",
        rule: "generic-api-key",
        artifact: "Animama-0.1.0-arm64.zip",
        path: "x.js",
        view: "text",
        line: 3,
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain("value");
  });

  it("writes a passing receipt bound to the exact artifact index", async () => {
    const root = scratch();
    const directory = candidate(root, {
      "THIRD_PARTY_NOTICES.txt": "notices\n",
      [PACK]: tarZst(root, (source) =>
        writeFileSync(path.join(source, "model.json"), "{}"),
      ),
    });
    const receipt = await scan(root, directory);
    expect(receipt.result).toBe("pass");
    expect(receipt.artifact_index_sha256).toBe(
      sha256(path.join(directory, "release-artifacts.json")),
    );
    expect(receipt.files).toEqual([
      {
        name: "THIRD_PARTY_NOTICES.txt",
        sha256: sha256(path.join(directory, "THIRD_PARTY_NOTICES.txt")),
      },
      { name: PACK, sha256: sha256(path.join(directory, PACK)) },
    ]);
    expect(receipt.scanner).toMatchObject({
      name: "gitleaks",
      version: "8.30.1",
      canary: "detected",
    });
    expect(receipt.coverage).toMatchObject({ expanded_archives: 1 });
    expect(
      JSON.parse(readFileSync(path.join(directory, "release-scan.json"))),
    ).toEqual(receipt);
  });

  it("scans nested archives, ASAR files and binaries in default-allowlisted paths", async () => {
    const root = scratch();
    const asarSource = path.join(root, "asar-src");
    mkdirSync(asarSource);
    writeFileSync(path.join(asarSource, "main.js"), "const k = 'FAKE-LEAK';\n");
    await createPackage(asarSource, path.join(root, "app.asar"));
    const directory = candidate(root, {
      [PACK]: tarZst(root, (source) => {
        writeFileSync(
          path.join(source, "app.asar"),
          readFileSync(path.join(root, "app.asar")),
        );
        writeFileSync(
          path.join(source, "lexicon.db"),
          Buffer.from("SQLite format 3\0token FAKE-LEAK here\0"),
        );
        mkdirSync(path.join(source, "node_modules"));
        writeFileSync(
          path.join(source, "node_modules", "native.node"),
          Buffer.concat([
            Buffer.from([0, 0, 0]),
            Buffer.from("token FAKE-LEAK here\0"),
          ]),
        );
        const inner = path.join(root, "inner");
        mkdirSync(inner);
        writeFileSync(
          path.join(inner, "build.cfg"),
          "prefix=/Users/someone/src\n",
        );
        spawnSync("tar", [
          "-czf",
          path.join(source, "data.tar.gz"),
          "-C",
          inner,
          ".",
        ]);
      }),
    });
    const receipt = await scan(root, directory);
    expect(receipt.result).toBe("fail");
    expect(receipt.findings).toEqual(
      expect.arrayContaining([
        {
          source: "gitleaks",
          rule: "generic-api-key",
          artifact: PACK,
          path: `${IN_PACK}/app.asar.expanded/main.js`,
          view: "text",
          line: 1,
        },
        expect.objectContaining({
          source: "gitleaks",
          path: `${IN_PACK}/node_modules/native.node`,
          view: "strings",
        }),
        expect.objectContaining({
          source: "gitleaks",
          path: `${IN_PACK}/lexicon.db`,
          view: "strings",
        }),
        {
          source: "private-text",
          rule: "home-directory",
          artifact: PACK,
          path: `${IN_PACK}/data.tar.gz.expanded/build.cfg`,
        },
      ]),
    );
    const text = readFileSync(
      path.join(directory, "release-scan.json"),
      "utf8",
    );
    expect(text).not.toContain("/Users/someone/");
    expect(text).not.toContain("FAKE-LEAK");
  });

  it("discloses ONNX weights excluded from Gitleaks but still searches them", async () => {
    const root = scratch();
    const directory = candidate(root, {
      [PACK]: tarZst(root, (source) =>
        writeFileSync(
          path.join(source, "model.onnx"),
          "FAKE-LEAK /Users/someone/",
        ),
      ),
    });
    const receipt = await scan(root, directory);
    expect(receipt.coverage.excluded_from_gitleaks).toEqual({ onnx: 1 });
    expect(receipt.findings).toEqual([
      {
        source: "private-text",
        rule: "home-directory",
        artifact: PACK,
        path: `${IN_PACK}/model.onnx`,
      },
    ]);
  });

  it("flags symlinks that point outside the bundle or at private paths", async () => {
    const root = scratch();
    const directory = candidate(root, {
      [PACK]: tarZst(root, (source) => {
        symlinkSync("/Users/someone/models", path.join(source, "models"));
        symlinkSync("../../outside", path.join(source, "escape"));
        symlinkSync("model.json", path.join(source, "current"));
      }),
    });
    const receipt = await scan(root, directory);
    expect(receipt.findings).toEqual([
      {
        source: "symlink",
        rule: "symlink-outside-artifact",
        artifact: PACK,
        path: `${IN_PACK}/escape`,
      },
      {
        source: "symlink",
        rule: "symlink-outside-artifact",
        artifact: PACK,
        path: `${IN_PACK}/models`,
      },
      {
        source: "symlink",
        rule: "home-directory",
        artifact: PACK,
        path: `${IN_PACK}/models`,
      },
    ]);
  });

  it("does not clear a candidate when the scanner is wrong or fails", async () => {
    const root = scratch();
    const directory = candidate(root, { "notes.txt": "clean\n" });
    await expect(
      scan(root, directory, { detectCanary: false }),
    ).rejects.toThrow(/canary/u);
    await expect(scan(root, directory, { version: "8.0.0" })).rejects.toThrow(
      /pinned Gitleaks/u,
    );
    await expect(scan(root, directory, { crash: true })).rejects.toThrow(
      /did not complete/u,
    );
  });

  it("rejects a candidate whose files changed after indexing", async () => {
    const root = scratch();
    const directory = candidate(root, { "notes.txt": "clean\n" });
    writeFileSync(path.join(directory, "notes.txt"), "changed\n");
    await expect(scan(root, directory)).rejects.toThrow(
      /does not match its files/u,
    );
  });
});
