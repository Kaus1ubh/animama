import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PRIVATE_FIELDS,
  PackError,
  STAGED_RELATIVE,
  fetchPack,
  manifestFor,
  publishPack,
  scanForPackBytes,
  stagePack,
  verifyPack,
} from "../scripts/runtime/mixamo-motion.mjs";

let root;
const write = (relative, text) => {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};

/** A synthetic two-clip pack; no Mixamo bytes are involved. */
function fixture() {
  write("input/gestures/wave/wave.vrma", "synthetic wave motion");
  write("input/gestures/wave/wave.meta.json", '{"name":"Wave"}');
  write("input/idle-styles/calm/calm.json", '{"name":"Calm"}');
  const manifest = manifestFor(path.join(root, "input"), "v1");
  // Only the motion payload needs Mixamo provenance; the Idle Style does not.
  const privateInventory = {
    clips: {
      "gestures/wave": {
        ...Object.fromEntries(
          PRIVATE_FIELDS.map((field) => [field, "recorded"]),
        ),
        sha256: manifest.files.find(
          (file) => file.path === "gestures/wave/wave.vrma",
        ).sha256,
      },
    },
  };
  const inventory = write(
    "inventory.json",
    JSON.stringify({ schema_version: 1, rules: [{ glob: "**" }] }),
  );
  return { manifest, privateInventory, inventory };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "mixamo-motion-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Mixamo-motion pack verification", () => {
  it("passes an exact pack with complete provenance", () => {
    const { manifest, privateInventory } = fixture();
    expect(
      verifyPack({ dir: path.join(root, "input"), manifest, privateInventory }),
    ).toEqual([]);
  });

  it("names missing, extra, changed and linked files and incomplete provenance", () => {
    const { manifest, privateInventory } = fixture();
    rmSync(path.join(root, "input/idle-styles/calm/calm.json"));
    write("input/gestures/wave/extra.vrma", "extra");
    write("input/gestures/wave/wave.vrma", "changed bytes");
    symlinkSync(
      path.join(root, "inventory.json"),
      path.join(root, "input/link.json"),
    );
    delete privateInventory.clips["gestures/wave"].licensee;
    const problems = verifyPack({
      dir: path.join(root, "input"),
      manifest,
      privateInventory,
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        { path: "idle-styles/calm/calm.json", reason: "missing" },
        { path: "gestures/wave/extra.vrma", reason: "extra" },
        { path: "gestures/wave/wave.vrma", reason: "mismatch" },
        { path: "link.json", reason: "link" },
        { path: "gestures/wave", reason: "provenance" },
      ]),
    );
    expect(JSON.stringify(problems)).not.toContain("synthetic");
  });
});

describe("Mixamo-motion staging", () => {
  it("stages nothing without an input unless the pack is required", () => {
    const { manifest, inventory } = fixture();
    const runtime = path.join(root, "runtime");
    expect(
      stagePack({
        runtime,
        input: path.join(root, "absent"),
        manifest,
        inventory,
      }),
    ).toEqual({ staged: false, files: 0 });
    expect(() =>
      stagePack({
        runtime,
        input: path.join(root, "absent"),
        manifest,
        inventory,
        required: true,
      }),
    ).toThrow(PackError);
  });

  it("copies only manifest files plus the licence inventory", () => {
    const { manifest, privateInventory, inventory } = fixture();
    const runtime = path.join(root, "runtime");
    const result = stagePack({
      runtime,
      input: path.join(root, "input"),
      manifest,
      inventory,
      privateInventory,
    });
    expect(result).toEqual({ staged: true, files: 3 });
    const staged = path.join(runtime, STAGED_RELATIVE);
    expect(
      readFileSync(path.join(staged, "gestures/wave/wave.vrma"), "utf8"),
    ).toBe("synthetic wave motion");
    expect(existsSync(path.join(staged, "licenses/inventory.json"))).toBe(true);
  });

  it("refuses a mismatched input or an input with an empty manifest", () => {
    const { manifest, privateInventory, inventory } = fixture();
    write("input/gestures/wave/wave.vrma", "changed bytes");
    expect(() =>
      stagePack({
        runtime: path.join(root, "runtime"),
        input: path.join(root, "input"),
        manifest,
        inventory,
        privateInventory,
      }),
    ).toThrow(/gestures\/wave\/wave\.vrma \(mismatch\)/u);
    expect(() =>
      stagePack({
        runtime: path.join(root, "runtime"),
        input: path.join(root, "input"),
        manifest: { ...manifest, files: [] },
        inventory,
      }),
    ).toThrow(PackError);
  });
});

describe("Mixamo-motion provenance", () => {
  it("requires the record's hash to be the payload's, not another file's", () => {
    const { manifest, privateInventory } = fixture();
    privateInventory.clips["gestures/wave"].sha256 = manifest.files.find(
      (file) => file.path === "gestures/wave/wave.meta.json",
    ).sha256;
    expect(
      verifyPack({ dir: path.join(root, "input"), manifest, privateInventory }),
    ).toEqual([{ path: "gestures/wave", reason: "provenance" }]);
  });
});

describe("Mixamo-motion leak scan", () => {
  it("finds pack bytes in directories and archives, except where allowed", () => {
    const { manifest } = fixture();
    write("tree/elsewhere/copy.vrma", "synthetic wave motion");
    write(
      "tree/runtime/content/mixamo-motion/wave.vrma",
      "synthetic wave motion",
    );
    write("tree/clean.txt", "nothing here");
    spawnSync("tar", [
      "-cf",
      path.join(root, "bundle.tar"),
      "-C",
      root,
      "input",
    ]);
    const findings = scanForPackBytes(
      [path.join(root, "tree"), path.join(root, "bundle.tar")],
      { manifest, allow: [/\/runtime\/content\/mixamo-motion\//u] },
    );
    expect(findings).toContain("tree/elsewhere/copy.vrma");
    expect(findings).toContain("bundle.tar/input/gestures/wave/wave.vrma");
    expect(findings.some((item) => item.includes("runtime/content"))).toBe(
      false,
    );
    expect(
      scanForPackBytes([path.join(root, "tree")], {
        manifest: { ...manifest, files: [] },
      }),
    ).toEqual([]);
  });

  it("skips symlinks, and fails clearly on a missing path unless told to skip", () => {
    const { manifest } = fixture();
    symlinkSync(path.join(root, "input"), path.join(root, "linked"));
    expect(scanForPackBytes([path.join(root, "linked")], { manifest })).toEqual(
      [],
    );
    expect(() =>
      scanForPackBytes([path.join(root, "missing")], { manifest }),
    ).toThrow(PackError);
    expect(
      scanForPackBytes([path.join(root, "missing")], {
        manifest,
        skipMissing: true,
      }),
    ).toEqual([]);
  });
});

describe("Mixamo-motion private store", () => {
  const credentials = {
    accountId: "0".repeat(32),
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    bucket: "private-bucket",
    keyPrefix: "built-in/mixamo-motion",
  };

  it("publishes only after verification and only with --confirm", async () => {
    const { manifest, privateInventory } = fixture();
    const privatePath = write("private.json", JSON.stringify(privateInventory));
    expect(
      await publishPack({
        manifest,
        input: path.join(root, "input"),
        privateInventory: privatePath,
      }),
    ).toEqual({ dryRun: true, objects: 4 });
    write("input/gestures/wave/wave.vrma", "changed bytes");
    await expect(
      publishPack({
        manifest,
        input: path.join(root, "input"),
        privateInventory: privatePath,
      }),
    ).rejects.toThrow(/mismatch/u);
  });

  it("refuses to overwrite an existing object of the same version", async () => {
    const { manifest, privateInventory } = fixture();
    const privatePath = write("private.json", JSON.stringify(privateInventory));
    const requests = [];
    const fakeFetch = async (url, init) => {
      requests.push(init.method);
      return new Response(null, { status: init.method === "HEAD" ? 200 : 500 });
    };
    await expect(
      publishPack({
        manifest,
        input: path.join(root, "input"),
        privateInventory: privatePath,
        confirm: true,
        credentials,
        fetch: fakeFetch,
      }),
    ).rejects.toThrow(/already exists for version v1/u);
    expect(requests).not.toContain("PUT");
  });

  it("fetches into the build input and verifies before replacing it", async () => {
    const { manifest, privateInventory } = fixture();
    const objects = new Map(
      manifest.files.map((file) => [
        `${credentials.keyPrefix}/v1/${file.path}`,
        readFileSync(path.join(root, "input", file.path)),
      ]),
    );
    objects.set(
      `${credentials.keyPrefix}/v1/private-inventory.json`,
      Buffer.from(JSON.stringify(privateInventory)),
    );
    const fakeFetch = async (url) => {
      const key = decodeURIComponent(
        new URL(url).pathname.split("/").slice(2).join("/"),
      );
      const body = objects.get(key);
      return body ? new Response(body) : new Response(null, { status: 404 });
    };
    const input = path.join(root, "fetched");
    const privatePath = path.join(root, "fetched.private.json");
    expect(
      await fetchPack({
        manifest,
        credentials,
        input,
        privateInventory: privatePath,
        fetch: fakeFetch,
      }),
    ).toEqual({ files: 3 });
    expect(verifyPack({ dir: input, manifest, privateInventory })).toEqual([]);
    objects.set(
      `${credentials.keyPrefix}/v1/gestures/wave/wave.vrma`,
      Buffer.from("x"),
    );
    await expect(
      fetchPack({
        manifest,
        credentials,
        input,
        privateInventory: privatePath,
        fetch: fakeFetch,
      }),
    ).rejects.toThrow(/mismatch/u);
    // A failed fetch keeps the previously verified input.
    expect(verifyPack({ dir: input, manifest, privateInventory })).toEqual([]);
  });
});
