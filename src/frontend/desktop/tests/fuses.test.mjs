import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFuseWire,
  defaultFuseWire,
  fuseDifferences,
  fuseNames,
  fuseSentinel,
  packedFuseWire,
  readFuseWire,
  smokeCopyFuseWire,
  writeFuseWire,
} from "../scripts/runtime/fuses.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** A binary-shaped file holding one fuse wire between unrelated bytes. */
function fixture(wire, { sentinels = 1 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "animama-fuses-"));
  roots.push(root);
  const block = Buffer.concat([
    Buffer.from(fuseSentinel, "latin1"),
    Buffer.from([1, wire.length]),
    Buffer.from(wire, "latin1"),
  ]);
  const file = path.join(root, "Animama.exe");
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.alloc(64, 7),
      ...Array.from({ length: sentinels }, () => block),
      Buffer.alloc(64, 9),
    ]),
  );
  return file;
}

describe("Electron fuse wire", () => {
  it("reads and checks a packed app's wire, naming each difference", () => {
    const app = fixture(packedFuseWire);

    expect(readFuseWire(app)).toBe(packedFuseWire);
    expect(() => assertFuseWire(app)).not.toThrow();
    expect(() => assertFuseWire(fixture(defaultFuseWire))).toThrow(
      /RunAsNode 1 \(expected 0\).*GrantFileProtocolExtraPrivileges 1 \(expected 0\)/u,
    );
    expect(fuseDifferences("0100", packedFuseWire)).toEqual([
      "wire length 4 (expected 9)",
    ]);
  });

  it("reads the wire from a macOS app's framework binary", () => {
    const root = mkdtempSync(path.join(tmpdir(), "animama-fuses-"));
    roots.push(root);
    const framework = path.join(
      root,
      "Animama.app/Contents/Frameworks/Electron Framework.framework",
    );
    mkdirSync(framework, { recursive: true });
    writeFileSync(
      path.join(framework, "Electron Framework"),
      readFileSync(fixture(packedFuseWire)),
    );

    expect(readFuseWire(path.join(root, "Animama.app"))).toBe(packedFuseWire);
  });

  it("refuses a binary with no wire or two", () => {
    const root = mkdtempSync(path.join(tmpdir(), "animama-fuses-"));
    roots.push(root);
    writeFileSync(path.join(root, "plain"), Buffer.alloc(32));

    expect(() => readFuseWire(path.join(root, "plain"))).toThrow(
      "exactly one Electron fuse wire",
    );
    expect(() =>
      readFuseWire(fixture(packedFuseWire, { sentinels: 2 })),
    ).toThrow("exactly one Electron fuse wire");
  });

  it("turns on only Node's inspect switches for the smoke copy", () => {
    const app = fixture(packedFuseWire);
    const copy = smokeCopyFuseWire();

    writeFuseWire(app, copy);

    expect(readFuseWire(app)).toBe(copy);
    expect(fuseDifferences(copy, packedFuseWire)).toEqual([
      "EnableNodeCliInspectArguments 1 (expected 0)",
    ]);
  });

  it("matches electron-builder's electronFuses settings over Electron's defaults", () => {
    const config = readFileSync(
      new URL("../electron-builder.yml", import.meta.url),
      "utf8",
    );
    // The indented lines under electronFuses, up to the next top-level key.
    const lines = config.split(/\r?\n/u);
    const first = lines.indexOf("electronFuses:") + 1;
    const block = lines.slice(
      first,
      lines.findIndex((line, index) => index >= first && /^[^\s#]/u.test(line)),
    );
    const wire = [...defaultFuseWire];
    for (const [, key, value] of block
      .map((line) => line.match(/^ {2}(\w+): (true|false)$/u))
      .filter(Boolean)) {
      if (key === "resetAdHocDarwinSignature") continue;
      const index = fuseNames.findIndex(
        (name) => name[0].toLowerCase() + name.slice(1) === key,
      );
      expect(index, key).toBeGreaterThanOrEqual(0);
      wire[index] = value === "true" ? "1" : "0";
    }

    expect(wire.join("")).toBe(packedFuseWire);
  });

  // Electron's binary is installed only where the desktop app is packed;
  // elsewhere resolving it would download it.
  it.runIf(["darwin", "win32"].includes(process.platform))(
    "keeps Electron's own defaults as recorded",
    () => {
      const binary = createRequire(import.meta.url)("electron");
      const app = binary.includes(".app/")
        ? binary.slice(0, binary.indexOf(".app/") + 4)
        : binary;

      expect(readFuseWire(app)).toBe(defaultFuseWire);
    },
  );
});
