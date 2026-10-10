/**
 * Private, non-portable Included packs (Mixamo motion, licensed comedy sound
 * effects): verified private build input, staging and leak scanning.
 *
 * A pack's bytes never enter Git, Docker contexts, self-host images or public
 * packages. Each pack's tracked, public-safe manifest lists every file by path,
 * size and SHA-256; the backend ships the same file as a restricted-hash
 * resource. Owner-only provenance stays in a private inventory beside the
 * build input and is never staged. Messages name paths only, never contents,
 * credentials or private locations.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { readJson, repoRoot, run } from "./common.mjs";

const resources = path.join(repoRoot, "src/backend/animama/resources");

/**
 * Hashes of the vendor's watermarked preview sounds. They may never ship
 * anywhere, so the release scan allows them in no location. A backend
 * resource, like the manifests, because the backend restricts them too.
 */
export const PREVIEW_DENY_PATH = path.join(
  resources,
  "wow-comedy-sfx-preview-deny.json",
);

/**
 * One private pack. Paths follow the pack ID: the tracked manifest (also the
 * backend's restricted-hash resource), the tracked licence inventory copied
 * into the staged pack, the ignored build input (never inside `content/`) and
 * the owner-only provenance fetched beside it, never staged.
 */
function definePack({
  id,
  label,
  payload,
  recordKey,
  records,
  privateFields,
  envPrefix,
  prefixEnv = `${envPrefix}_PREFIX`,
  defaultPrefix = null,
  requireEnv,
  denyListPath = null,
}) {
  return Object.freeze({
    id,
    label,
    manifestPath: path.join(resources, `${id}-manifest.json`),
    inventoryPath: path.join(repoRoot, "scripts", id, "inventory.json"),
    inputDir: path.join(repoRoot, "build-inputs", id),
    privateInventoryPath: path.join(
      repoRoot,
      "build-inputs",
      `${id}.private.json`,
    ),
    /** Where the pack lives inside a staged desktop runtime. */
    stagedRelative: `content/${id}`,
    /** Files that need a provenance record; descriptors and sidecars do not. */
    payload,
    /** The private-inventory record that covers a payload path. */
    recordKey,
    /** The private inventory's record map. */
    records,
    /** Provenance every record needs before a build may ship it. */
    privateFields,
    /** The private bucket and its read/write tokens: `<envPrefix>_BUCKET`, … */
    envPrefix,
    /** The pack's own key prefix in that bucket, with an optional default. */
    prefixEnv,
    defaultPrefix,
    /** Release candidates set this to `1` so a missing pack fails the build. */
    requireEnv,
    /** Hashes that may appear nowhere, such as the vendor's watermarked previews. */
    denyListPath,
  });
}

export const MIXAMO_MOTION = definePack({
  id: "mixamo-motion",
  label: "Mixamo-motion",
  payload: /\.vrma$/iu,
  // A clip folder, `gestures/<id>`, holds one motion payload.
  recordKey: (file) => file.split("/").slice(0, 2).join("/"),
  records: "clips",
  privateFields: [
    "animation_name",
    "animation_id",
    "character",
    "export_settings",
    "download_date",
    "licensee",
    "conversion_tool",
    "conversion_version",
    "conversion_steps",
    "sha256",
  ],
  envPrefix: "ANIMAMA_MIXAMO_R2",
  requireEnv: "ANIMAMA_REQUIRE_MIXAMO_MOTION",
});

export const WOW_COMEDY_SFX = definePack({
  id: "wow-comedy-sfx",
  label: "Comedy sound",
  payload: /\.ogg$/iu,
  // Sounds are standalone files, each its own record.
  recordKey: (file) => file,
  records: "sounds",
  privateFields: [
    "vendor",
    "product",
    "license_tier",
    "purchase_date",
    "licensee",
    "order_reference",
    "source_file",
    "sha256",
  ],
  // The same owner-only private bucket and bucket-scoped tokens as the Mixamo
  // pack, under its own prefix (each version writes its own private inventory).
  envPrefix: "ANIMAMA_MIXAMO_R2",
  prefixEnv: "ANIMAMA_WOW_COMEDY_SFX_R2_PREFIX",
  defaultPrefix: "built-in/wow-comedy-sfx",
  requireEnv: "ANIMAMA_REQUIRE_WOW_COMEDY_SFX",
  denyListPath: PREVIEW_DENY_PATH,
});

/** Every private pack; the desktop supervisor mounts the same IDs. */
export const PRIVATE_PACKS = Object.freeze([MIXAMO_MOTION, WOW_COMEDY_SFX]);

export function packById(id) {
  const pack = PRIVATE_PACKS.find((candidate) => candidate.id === id);
  if (!pack)
    throw new PackError(
      `Unknown private pack; use one of: ${PRIVATE_PACKS.map((item) => item.id).join(", ")}`,
    );
  return pack;
}

export class PackError extends Error {}

const SHA256 = /^[0-9a-f]{64}$/u;

/** Parse and validate a pack's tracked manifest. */
export function readManifest(pack, file = pack.manifestPath) {
  const value = readJson(file);
  if (
    value?.schema_version !== 1 ||
    value.pack_id !== pack.id ||
    typeof value.version !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value.version) ||
    !Array.isArray(value.files)
  )
    throw new PackError(`The ${pack.label} manifest is invalid`);
  const seen = new Set();
  for (const item of value.files) {
    const valid =
      typeof item?.path === "string" &&
      isSafeRelative(item.path) &&
      Number.isSafeInteger(item.size_bytes) &&
      item.size_bytes > 0 &&
      SHA256.test(item.sha256 ?? "");
    if (!valid || seen.has(item.path))
      throw new PackError(`The ${pack.label} manifest lists an invalid file`);
    seen.add(item.path);
  }
  return value;
}

/** Parse the preview deny list: sizes and hashes only, no paths. */
export function readDenyList(file = PREVIEW_DENY_PATH) {
  const value = readJson(file);
  const valid =
    value?.schema_version === 1 &&
    Array.isArray(value.files) &&
    value.files.every(
      (item) =>
        Number.isSafeInteger(item?.size_bytes) &&
        item.size_bytes > 0 &&
        SHA256.test(item.sha256 ?? ""),
    );
  if (!valid) throw new PackError("The preview deny list is invalid");
  return value;
}

function isSafeRelative(value) {
  const parts = value.split("/");
  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    parts.every((part) => part && part !== "." && part !== "..")
  );
}

/** Pack files are small assets, so whole-file reads keep this simple. */
function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Regular files below `root` as POSIX relative paths; links are reported. */
export function listFiles(root, relative = "", result = []) {
  for (const entry of readdirSync(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) result.push({ path: child, link: true });
    else if (entry.isDirectory()) listFiles(root, child, result);
    else if (entry.isFile()) result.push({ path: child, link: false });
  }
  return result;
}

/** Provenance records the manifest needs, each with its payload's entry. */
export function manifestRecords(pack, manifest) {
  const records = new Map();
  for (const file of manifest.files)
    if (pack.payload.test(file.path))
      records.set(pack.recordKey(file.path), file);
  return records;
}

/**
 * Check a build input against the manifest exactly, and the private inventory
 * for complete provenance. Returns problems as `{ path, reason }` only.
 */
export function verifyPack({ pack, dir, manifest, privateInventory }) {
  const problems = [];
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const found = existsSync(dir) ? listFiles(dir) : [];
  for (const file of found) {
    const declared = expected.get(file.path);
    if (file.link) problems.push({ path: file.path, reason: "link" });
    else if (!declared) problems.push({ path: file.path, reason: "extra" });
    else {
      const absolute = path.join(dir, file.path);
      if (
        lstatSync(absolute).size !== declared.size_bytes ||
        sha256File(absolute) !== declared.sha256
      )
        problems.push({ path: file.path, reason: "mismatch" });
    }
  }
  const present = new Set(found.map((file) => file.path));
  for (const file of manifest.files)
    if (!present.has(file.path))
      problems.push({ path: file.path, reason: "missing" });
  if (manifest.files.length) {
    const records = privateInventory?.[pack.records] ?? {};
    for (const [key, payload] of manifestRecords(pack, manifest)) {
      const record = records[key];
      const complete =
        record &&
        pack.privateFields.every(
          (field) =>
            record[field] !== undefined &&
            record[field] !== null &&
            String(record[field]).trim() !== "",
        ) &&
        record.sha256 === payload.sha256;
      if (!complete) problems.push({ path: key, reason: "provenance" });
    }
  }
  return problems.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Stage the verified pack into a desktop runtime. Without an input the build
 * simply has no pack, unless `required` (release candidates) is set.
 */
export function stagePack({
  pack,
  runtime,
  input = pack.inputDir,
  manifest = readManifest(pack),
  inventory = pack.inventoryPath,
  privateInventory = existsSync(pack.privateInventoryPath)
    ? readJson(pack.privateInventoryPath)
    : null,
  required = false,
}) {
  if (!existsSync(input)) {
    if (required)
      throw new PackError(
        `The ${pack.label} pack is required but the build input is missing; fetch it first`,
      );
    return { staged: false, files: 0 };
  }
  if (!manifest.files.length)
    throw new PackError(
      `A ${pack.label} build input exists but the manifest lists no files`,
    );
  const problems = verifyPack({ pack, dir: input, manifest, privateInventory });
  if (problems.length)
    throw new PackError(
      `The ${pack.label} build input does not match the manifest: ${problems
        .map((problem) => `${problem.path} (${problem.reason})`)
        .join(", ")}`,
    );
  const destination = path.join(runtime, pack.stagedRelative);
  rmSync(destination, { recursive: true, force: true });
  for (const file of manifest.files) {
    const target = path.join(destination, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(input, file.path), target);
  }
  mkdirSync(path.join(destination, "licenses"), { recursive: true });
  copyFileSync(inventory, path.join(destination, "licenses/inventory.json"));
  return { staged: true, files: manifest.files.length };
}

const ARCHIVE = /\.(zip|whl|jar|tar|tgz|tar\.gz)$/iu;

function expand(file, into) {
  mkdirSync(into, { recursive: true });
  const name = file.toLowerCase();
  if (/\.(zip|whl|jar)$/u.test(name))
    run(
      process.platform === "darwin" ? "ditto" : "unzip",
      process.platform === "darwin"
        ? ["-x", "-k", file, into]
        : ["-q", file, "-d", into],
      { capture: true },
    );
  else run("tar", ["-xf", file, "-C", into], { capture: true });
}

/** Archives deeper than this are reported rather than skipped (fail closed). */
const MAX_ARCHIVE_DEPTH = 3;

/**
 * Find files whose SHA-256 is listed in `manifest` (a pack manifest or the
 * preview deny list), in directories and archives (zip/wheel/tar/tgz, nested
 * up to three levels). Only files whose size equals a listed size are hashed,
 * so large trees and images stay cheap. Paths matching an `allow` pattern (the
 * staged pack itself) are not findings; archives nested too deeply are
 * findings. Symlinks are never followed.
 */
export function scanForPackBytes(
  targets,
  { manifest, allow = [], expandArchives = true, skipMissing = false } = {},
) {
  const findings = [];
  const hashes = new Set(manifest.files.map((file) => file.sha256));
  const sizes = new Set(manifest.files.map((file) => file.size_bytes));
  if (!hashes.size) return findings;
  const work = mkdtempSync(path.join(os.tmpdir(), "animama-pack-scan-"));
  let expansions = 0;
  const allowed = (shown) => allow.some((pattern) => pattern.test(shown));
  const check = (absolute, shown, depth) => {
    const size = lstatSync(absolute).size;
    if (sizes.has(size) && hashes.has(sha256File(absolute))) {
      if (!allowed(shown)) findings.push(shown);
    } else if (expandArchives && ARCHIVE.test(absolute)) {
      if (depth >= MAX_ARCHIVE_DEPTH) {
        findings.push(`${shown} (archive nested too deeply to scan)`);
        return;
      }
      const into = path.join(work, String(++expansions));
      expand(absolute, into);
      visit(into, shown, depth + 1);
    }
  };
  const visit = (root, label, depth) => {
    for (const file of listFiles(root))
      if (!file.link)
        check(path.join(root, file.path), `${label}/${file.path}`, depth);
  };
  try {
    for (const target of targets) {
      let stat;
      try {
        stat = lstatSync(target);
      } catch {
        if (skipMissing) continue;
        throw new PackError(`Cannot scan a missing path: ${target}`);
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(target, path.basename(target), 0);
      else check(target, path.basename(target), 0);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return findings.sort();
}

/** Owner-only read or publish credentials; values are never printed. */
export function packCredentials(pack, env = process.env, role = "read") {
  const prefix = `${pack.envPrefix}_${role === "read" ? "READ" : "WRITE"}`;
  const accountId = env.ANIMAMA_R2_ACCOUNT_ID ?? "";
  const accessKeyId = env[`${prefix}_ACCESS_KEY_ID`] ?? "";
  const secretAccessKey = env[`${prefix}_SECRET_ACCESS_KEY`] ?? "";
  const bucket = env[`${pack.envPrefix}_BUCKET`] ?? "";
  const keyPrefix = env[pack.prefixEnv] || pack.defaultPrefix || "";
  if (
    !/^[a-f0-9]{32}$/u.test(accountId) ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucket ||
    !isSafeRelative(keyPrefix)
  )
    throw new PackError(
      `Set ANIMAMA_R2_ACCOUNT_ID, ${prefix}_ACCESS_KEY_ID, ${prefix}_SECRET_ACCESS_KEY and ${pack.envPrefix}_BUCKET${pack.defaultPrefix ? "" : ` and ${pack.prefixEnv}`} from the owner-only file`,
    );
  return { accountId, accessKeyId, secretAccessKey, bucket, keyPrefix };
}

const objectKey = (credentials, manifest, relative) =>
  `${credentials.keyPrefix}/${manifest.version}/${relative}`;

async function signed(credentials, method, key, headers = {}) {
  const { AwsV4Signer } = await import("aws4fetch");
  const { keyPath } = await import("./r2-objects.mjs");
  return new AwsV4Signer({
    method,
    url: `https://${credentials.accountId}.r2.cloudflarestorage.com/${credentials.bucket}/${keyPath(key)}`,
    headers,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: "s3",
    region: "auto",
  }).sign();
}

/** Download the pack and private inventory into the ignored build input. */
export async function fetchPack({
  pack,
  manifest = readManifest(pack),
  credentials = packCredentials(pack),
  input = pack.inputDir,
  privateInventory = pack.privateInventoryPath,
  fetch: fetchImpl = fetch,
}) {
  if (!manifest.files.length)
    throw new PackError(
      "The manifest lists no files; there is nothing to fetch",
    );
  const staging = `${input}.partial`;
  rmSync(staging, { recursive: true, force: true });
  const download = async (relative, target) => {
    const request = await signed(
      credentials,
      "GET",
      objectKey(credentials, manifest, relative),
    );
    let response;
    try {
      response = await fetchImpl(request.url, {
        redirect: "error",
        headers: Object.fromEntries(request.headers),
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch {
      throw new PackError(
        `The private store could not be reached for ${relative}`,
      );
    }
    if (!response.ok || !response.body)
      throw new PackError(
        `The private store refused ${relative} (${response.status})`,
      );
    mkdirSync(path.dirname(target), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  };
  for (const file of manifest.files)
    await download(file.path, path.join(staging, file.path));
  await download("private-inventory.json", `${privateInventory}.partial`);
  const problems = verifyPack({
    pack,
    dir: staging,
    manifest,
    privateInventory: readJson(`${privateInventory}.partial`),
  });
  if (problems.length) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(`${privateInventory}.partial`, { force: true });
    throw new PackError(
      `The fetched pack does not match the manifest: ${problems.map((p) => `${p.path} (${p.reason})`).join(", ")}`,
    );
  }
  rmSync(input, { recursive: true, force: true });
  renameSync(staging, input);
  renameSync(`${privateInventory}.partial`, privateInventory);
  return { files: manifest.files.length };
}

/** Owner-only upload of a verified input; a dry run unless `confirm`. */
export async function publishPack({
  pack,
  manifest = readManifest(pack),
  input = pack.inputDir,
  privateInventory = pack.privateInventoryPath,
  confirm = false,
  credentials = confirm ? packCredentials(pack, process.env, "write") : null,
  fetch: fetchImpl = fetch,
}) {
  if (!manifest.files.length)
    throw new PackError(
      "The manifest lists no files; there is nothing to publish",
    );
  const problems = verifyPack({
    pack,
    dir: input,
    manifest,
    privateInventory: existsSync(privateInventory)
      ? readJson(privateInventory)
      : null,
  });
  if (problems.length)
    throw new PackError(
      `Refusing to publish: ${problems.map((p) => `${p.path} (${p.reason})`).join(", ")}`,
    );
  const uploads = [
    ...manifest.files.map((file) => [file.path, path.join(input, file.path)]),
    ["private-inventory.json", privateInventory],
  ];
  if (!confirm) return { dryRun: true, objects: uploads.length };
  const { r2Exists, r2Writer } = await import("./r2-objects.mjs");
  const exists = r2Exists({
    bucket: credentials.bucket,
    credentials,
    fetch: fetchImpl,
  });
  // A pack version is immutable: publish a new version rather than replace.
  for (const [relative] of uploads)
    if (await exists(objectKey(credentials, manifest, relative)))
      throw new PackError(
        `${relative} already exists for version ${manifest.version}; publish a new version instead`,
      );
  const put = r2Writer({
    bucket: credentials.bucket,
    credentials,
    fetch: fetchImpl,
  });
  for (const [relative, file] of uploads)
    await put(
      objectKey(credentials, manifest, relative),
      file,
      sha256File(file),
      {
        createOnly: true,
        cacheControl: "private, no-store",
      },
    );
  return { dryRun: false, objects: uploads.length };
}

/** Write a manifest for a verified local pack (owner, before publishing). */
export function manifestFor(pack, dir, version) {
  return {
    schema_version: 1,
    pack_id: pack.id,
    version,
    files: listFiles(dir)
      .filter((file) => !file.link)
      .map((file) => ({
        path: file.path,
        size_bytes: lstatSync(path.join(dir, file.path)).size,
        sha256: sha256File(path.join(dir, file.path)),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * Hash rules for an expanded release candidate: each pack's bytes may appear
 * only inside the app's own runtime directory (macOS or Windows layout), and
 * deny-listed bytes nowhere.
 */
export function releaseScanRules({
  packs = PRIVATE_PACKS,
  manifestOf = readManifest,
  denyListOf = readDenyList,
} = {}) {
  return packs.flatMap((pack) => [
    {
      manifest: manifestOf(pack),
      allow: [
        new RegExp(
          `/(Contents/)?[Rr]esources/runtime/${pack.stagedRelative}/`,
          "u",
        ),
      ],
      rule: `${pack.id}-outside-runtime`,
    },
    ...(pack.denyListPath
      ? [
          {
            manifest: denyListOf(pack.denyListPath),
            allow: [],
            rule: "watermarked-preview",
          },
        ]
      : []),
  ]);
}
