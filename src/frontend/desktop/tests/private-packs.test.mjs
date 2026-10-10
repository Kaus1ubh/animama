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
  MIXAMO_MOTION,
  PRIVATE_PACKS,
  PackError,
  WOW_COMEDY_SFX,
  fetchPack,
  manifestFor,
  packById,
  publishPack,
  readDenyList,
  readManifest,
  releaseScanRules,
  scanForPackBytes,
  stagePack,
  verifyPack,
} from "../scripts/runtime/private-packs.mjs";
import { PRIVATE_PACK_IDS } from "../src/main-process/runtime/supervisor.js";

let root;
const write = (relative, text) => {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};

/**
 * Synthetic packs; no licensed bytes are involved. `payload` is the file that
 * needs provenance, `record` its private-inventory key, and `other` a file that
 * needs none.
 */
const CASES = [
  {
    pack: MIXAMO_MOTION,
    files: {
      "gestures/wave/wave.vrma": "synthetic wave motion",
      "gestures/wave/wave.meta.json": '{"name":"Wave"}',
      "idle-styles/calm/calm.json": '{"name":"Calm"}',
    },
    payload: "gestures/wave/wave.vrma",
    record: "gestures/wave",
    other: "idle-styles/calm/calm.json",
  },
  {
    pack: WOW_COMEDY_SFX,
    files: {
      "sfx/wow-comedy/bell_ding.ogg": "synthetic bell sound",
      "sfx/wow-comedy/bell_ding.meta.json": '{"name":"Bell Ding"}',
      "sfx/wow-comedy/pop.meta.json": '{"name":"Pop"}',
    },
    payload: "sfx/wow-comedy/bell_ding.ogg",
    record: "sfx/wow-comedy/bell_ding.ogg",
    other: "sfx/wow-comedy/pop.meta.json",
  },
];

function fixture({ pack, files, payload, record }) {
  for (const [relative, text] of Object.entries(files))
    write(`input/${relative}`, text);
  const manifest = manifestFor(pack, path.join(root, "input"), "v1");
  const privateInventory = {
    [pack.records]: {
      [record]: {
        ...Object.fromEntries(
          pack.privateFields.map((field) => [field, "recorded"]),
        ),
        sha256: manifest.files.find((file) => file.path === payload).sha256,
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
  root = mkdtempSync(path.join(os.tmpdir(), "private-pack-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.each(CASES)("$pack.label pack", (item) => {
  const { pack } = item;

  describe("verification", () => {
    it("passes an exact pack with complete provenance", () => {
      const { manifest, privateInventory } = fixture(item);
      expect(
        verifyPack({
          pack,
          dir: path.join(root, "input"),
          manifest,
          privateInventory,
        }),
      ).toEqual([]);
    });

    it("names missing, extra, changed and linked files and incomplete provenance", () => {
      const { manifest, privateInventory } = fixture(item);
      rmSync(path.join(root, "input", item.other));
      write(`input/${path.posix.dirname(item.payload)}/extra.bin`, "extra");
      write(`input/${item.payload}`, "changed bytes");
      symlinkSync(
        path.join(root, "inventory.json"),
        path.join(root, "input/link.json"),
      );
      delete privateInventory[pack.records][item.record].licensee;
      const problems = verifyPack({
        pack,
        dir: path.join(root, "input"),
        manifest,
        privateInventory,
      });
      expect(problems).toEqual(
        expect.arrayContaining([
          { path: item.other, reason: "missing" },
          {
            path: `${path.posix.dirname(item.payload)}/extra.bin`,
            reason: "extra",
          },
          { path: item.payload, reason: "mismatch" },
          { path: "link.json", reason: "link" },
          { path: item.record, reason: "provenance" },
        ]),
      );
      expect(JSON.stringify(problems)).not.toContain("synthetic");
    });
  });

  describe("staging", () => {
    it("stages nothing without an input unless the pack is required", () => {
      const { manifest, inventory } = fixture(item);
      const runtime = path.join(root, "runtime");
      expect(
        stagePack({
          pack,
          runtime,
          input: path.join(root, "absent"),
          manifest,
          inventory,
        }),
      ).toEqual({ staged: false, files: 0 });
      expect(() =>
        stagePack({
          pack,
          runtime,
          input: path.join(root, "absent"),
          manifest,
          inventory,
          required: true,
        }),
      ).toThrow(PackError);
    });

    it("copies only manifest files plus the licence inventory", () => {
      const { manifest, privateInventory, inventory } = fixture(item);
      const runtime = path.join(root, "runtime");
      const result = stagePack({
        pack,
        runtime,
        input: path.join(root, "input"),
        manifest,
        inventory,
        privateInventory,
      });
      expect(result).toEqual({ staged: true, files: 3 });
      const staged = path.join(runtime, pack.stagedRelative);
      expect(readFileSync(path.join(staged, item.payload), "utf8")).toBe(
        item.files[item.payload],
      );
      expect(existsSync(path.join(staged, "licenses/inventory.json"))).toBe(
        true,
      );
    });

    it("refuses a mismatched input or an input with an empty manifest", () => {
      const { manifest, privateInventory, inventory } = fixture(item);
      write(`input/${item.payload}`, "changed bytes");
      expect(() =>
        stagePack({
          pack,
          runtime: path.join(root, "runtime"),
          input: path.join(root, "input"),
          manifest,
          inventory,
          privateInventory,
        }),
      ).toThrow(`${item.payload} (mismatch)`);
      expect(() =>
        stagePack({
          pack,
          runtime: path.join(root, "runtime"),
          input: path.join(root, "input"),
          manifest: { ...manifest, files: [] },
          inventory,
        }),
      ).toThrow(PackError);
    });
  });

  describe("provenance", () => {
    it("requires the record's hash to be the payload's, not another file's", () => {
      const { manifest, privateInventory } = fixture(item);
      privateInventory[pack.records][item.record].sha256 = manifest.files.find(
        (file) => file.path !== item.payload,
      ).sha256;
      expect(
        verifyPack({
          pack,
          dir: path.join(root, "input"),
          manifest,
          privateInventory,
        }),
      ).toEqual([{ path: item.record, reason: "provenance" }]);
    });
  });

  describe("leak scan", () => {
    it("finds pack bytes in directories and archives, except where allowed", () => {
      const { manifest } = fixture(item);
      const bytes = item.files[item.payload];
      write("tree/elsewhere/copy.bin", bytes);
      write(`tree/runtime/${pack.stagedRelative}/copy.bin`, bytes);
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
        {
          manifest,
          allow: [new RegExp(`/runtime/${pack.stagedRelative}/`, "u")],
        },
      );
      expect(findings).toContain("tree/elsewhere/copy.bin");
      expect(findings).toContain(`bundle.tar/input/${item.payload}`);
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
      const { manifest } = fixture(item);
      symlinkSync(path.join(root, "input"), path.join(root, "linked"));
      expect(
        scanForPackBytes([path.join(root, "linked")], { manifest }),
      ).toEqual([]);
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

  describe("private store", () => {
    const credentials = {
      accountId: "0".repeat(32),
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "private-bucket",
      keyPrefix: `built-in/${pack.id}`,
    };

    it("publishes only after verification and only with --confirm", async () => {
      const { manifest, privateInventory } = fixture(item);
      const privatePath = write(
        "private.json",
        JSON.stringify(privateInventory),
      );
      expect(
        await publishPack({
          pack,
          manifest,
          input: path.join(root, "input"),
          privateInventory: privatePath,
        }),
      ).toEqual({ dryRun: true, objects: 4 });
      write(`input/${item.payload}`, "changed bytes");
      await expect(
        publishPack({
          pack,
          manifest,
          input: path.join(root, "input"),
          privateInventory: privatePath,
        }),
      ).rejects.toThrow(/mismatch/u);
    });

    it("refuses to overwrite an existing object of the same version", async () => {
      const { manifest, privateInventory } = fixture(item);
      const privatePath = write(
        "private.json",
        JSON.stringify(privateInventory),
      );
      const requests = [];
      const fakeFetch = async (url, init) => {
        requests.push(init.method);
        return new Response(null, {
          status: init.method === "HEAD" ? 200 : 500,
        });
      };
      await expect(
        publishPack({
          pack,
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
      const { manifest, privateInventory } = fixture(item);
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
          pack,
          manifest,
          credentials,
          input,
          privateInventory: privatePath,
          fetch: fakeFetch,
        }),
      ).toEqual({ files: 3 });
      expect(
        verifyPack({ pack, dir: input, manifest, privateInventory }),
      ).toEqual([]);
      objects.set(
        `${credentials.keyPrefix}/v1/${item.payload}`,
        Buffer.from("x"),
      );
      await expect(
        fetchPack({
          pack,
          manifest,
          credentials,
          input,
          privateInventory: privatePath,
          fetch: fakeFetch,
        }),
      ).rejects.toThrow(/mismatch/u);
      // A failed fetch keeps the previously verified input.
      expect(
        verifyPack({ pack, dir: input, manifest, privateInventory }),
      ).toEqual([]);
    });
  });
});

describe("private pack definitions", () => {
  it("mounts the same pack IDs the tooling stages", () => {
    expect(PRIVATE_PACKS.map((pack) => pack.id)).toEqual([...PRIVATE_PACK_IDS]);
    expect(packById("wow-comedy-sfx")).toBe(WOW_COMEDY_SFX);
    expect(() => packById("unknown")).toThrow(PackError);
  });

  it("reads each tracked manifest and the preview deny list", () => {
    for (const pack of PRIVATE_PACKS)
      expect(readManifest(pack).pack_id).toBe(pack.id);
    expect(readDenyList().files.length).toBeGreaterThan(0);
  });

  it("refuses a manifest that names another pack", () => {
    const file = write(
      "manifest.json",
      JSON.stringify({
        schema_version: 1,
        pack_id: "mixamo-motion",
        version: "v1",
        files: [],
      }),
    );
    expect(() => readManifest(WOW_COMEDY_SFX, file)).toThrow(PackError);
  });

  it("lets each pack's bytes appear only in its own runtime directory", () => {
    const rules = releaseScanRules({
      manifestOf: (pack) => ({ pack_id: pack.id, files: [] }),
      denyListOf: () => ({ files: [] }),
    });
    expect(rules.map((item) => item.rule)).toEqual([
      "mixamo-motion-outside-runtime",
      "wow-comedy-sfx-outside-runtime",
      "watermarked-preview",
    ]);
    const [mixamo, sounds, previews] = rules;
    const mac = "x/Animama.app/Contents/Resources/runtime/content";
    const win = "x/resources/runtime/content";
    expect(mixamo.allow[0].test(`${mac}/mixamo-motion/a.vrma`)).toBe(true);
    expect(sounds.allow[0].test(`${win}/wow-comedy-sfx/a.ogg`)).toBe(true);
    expect(mixamo.allow[0].test(`${mac}/wow-comedy-sfx/a.ogg`)).toBe(false);
    expect(sounds.allow[0].test(`${mac}/included-core/a.ogg`)).toBe(false);
    expect(previews.allow).toEqual([]);
  });

  it("refuses to publish an empty manifest", async () => {
    await expect(
      publishPack({
        pack: WOW_COMEDY_SFX,
        manifest: { pack_id: "wow-comedy-sfx", version: "v0", files: [] },
        input: path.join(root, "absent"),
        privateInventory: path.join(root, "absent.json"),
      }),
    ).rejects.toThrow(/nothing to publish/u);
  });

  it("finds watermarked preview bytes by hash", () => {
    const file = write("tree/preview.ogg", "watermarked preview");
    const deny = {
      files: [
        {
          size_bytes: readFileSync(file).length,
          sha256: manifestFor(WOW_COMEDY_SFX, path.join(root, "tree"), "v1")
            .files[0].sha256,
        },
      ],
    };
    expect(
      scanForPackBytes([path.join(root, "tree")], { manifest: deny }),
    ).toEqual(["tree/preview.ogg"]);
  });
});
