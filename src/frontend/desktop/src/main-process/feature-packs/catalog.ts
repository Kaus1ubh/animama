import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  featurePackIds,
  type FeaturePackId,
} from "../../../../shared/desktop-runtime.js";
import { RuntimeError } from "../runtime/errors.js";
import {
  isReleaseDistribution,
  isReleaseTag,
  type ReleaseDistribution,
} from "../updates/policy.js";

export type PackFile = {
  path: string;
  size_bytes: number;
  sha256: string;
  media_type: string;
  mode: "0644" | "0755";
};
/**
 * One archive pack: a data-only tree delivered as an exact `.tar.zst`. The
 * format keeps its platform, architecture, signing and mode fields, which
 * validation fixes to data-only, unsigned and `0644`.
 */
export type PackManifest = {
  schema: "animama-feature-pack/1";
  id: FeaturePackId;
  display_name: string;
  version: string;
  app_versions: string[];
  platform: "darwin" | "win32" | "data-only";
  architecture: "arm64" | "x64" | "data-only";
  installed_bytes: number;
  minimum_peak_free_bytes: number;
  license_refs: string[];
  files: PackFile[];
  signing: { publisher: string; requirement: string } | null;
  url: string;
  archive_bytes: number;
  archive_sha256: string;
};
export type PackCatalog = {
  entries: PackManifest[];
  development: boolean;
  /** The build's sealed transport; null only for unpackaged runtimes without a staged policy. */
  distribution: ReleaseDistribution | null;
};
export const PACK_METADATA = ".animama-pack.json";
const MAX_CATALOG_BYTES = 24 * 1024 * 1024;
const MAX_PACK_BYTES = 2 * 1024 ** 3;
const SAFETY_RESERVE_BYTES = 64 * 1024 ** 2;
export const MAX_ENTRIES = 100_000;
const SHA = /^[a-f0-9]{64}$/u;
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/u;

export function packId(value: unknown): FeaturePackId {
  if (!featurePackIds.includes(value as FeaturePackId))
    throw new RuntimeError("feature_pack_invalid");
  return value as FeaturePackId;
}

/** Fold compatibility/case variants as well as rejecting noncanonical Unicode. */
export function pathKey(value: string): string {
  return value.normalize("NFKC").toUpperCase().toLowerCase();
}
export function portablePath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 240 ||
    value !== value.normalize("NFC") ||
    /[\\:\x00-\x1f\x7f]/u.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    throw new RuntimeError("pack_path_invalid");
}
function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}
function keys(value: unknown, expected: string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== expected.sort().join("|")
  )
    throw new RuntimeError("pack_manifest_invalid");
}
export function manifestDigest(manifest: PackManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
/** The archive digest names the installed content; app compatibility does not. */
export function versionDirectory(manifest: PackManifest): string {
  return `${manifest.version}-${manifest.archive_sha256.slice(0, 16)}`;
}
/** The archive, its extracted copy and a retained prior version can coexist. */
export function requiredFreeBytes(manifest: PackManifest): number {
  return Math.max(
    manifest.minimum_peak_free_bytes,
    manifest.archive_bytes +
      2 * manifest.installed_bytes +
      SAFETY_RESERVE_BYTES,
  );
}

const GITHUB_ASSET_HOSTS = [
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
];

/** Is this catalog URL a pack archive in the sealed distribution's release folders? */
function isReleasePackUrl(
  url: URL,
  distribution: ReleaseDistribution | null,
): boolean {
  if (url.search || !url.pathname.endsWith(".tar.zst")) return false;
  if (distribution?.kind === "r2") {
    // <base>/v<version>/<archive>
    const base = new URL(distribution.base_url);
    const rest = url.pathname.startsWith(`${base.pathname}/`)
      ? url.pathname.slice(base.pathname.length + 1).split("/")
      : [];
    return (
      url.origin === base.origin &&
      rest.length === 2 &&
      isReleaseTag(rest[0]) &&
      Boolean(rest[1])
    );
  }
  // /<owner>/<repo>/releases/download/<tag>/<archive>; a runtime without a
  // staged policy (tests and unpackaged development) keeps the any-repository rule.
  const [, owner, repo, releases, download, tag, name, ...extra] =
    url.pathname.split("/");
  return (
    url.hostname === "github.com" &&
    releases === "releases" &&
    download === "download" &&
    Boolean(owner && repo && tag && name) &&
    extra.length === 0 &&
    (!distribution ||
      (owner === distribution.owner && repo === distribution.repo))
  );
}

/**
 * URLs are supplied by the embedded catalog, never by a renderer or redirect
 * filename, and must match the transport sealed in this build. GitHub assets
 * redirect to its CDN; R2 serves objects directly, so R2 builds never follow a
 * redirect.
 */
export function downloadUrl(
  value: string,
  options: {
    development: boolean;
    distribution: ReleaseDistribution | null;
    redirect?: boolean;
  },
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RuntimeError("pack_url_invalid");
  }
  const fixture =
    options.development &&
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1";
  const release =
    url.protocol === "https:" &&
    !url.port &&
    (options.redirect
      ? options.distribution?.kind !== "r2" &&
        GITHUB_ASSET_HOSTS.includes(url.hostname)
      : isReleasePackUrl(url, options.distribution));
  if ((!fixture && !release) || url.username || url.password || url.hash)
    throw new RuntimeError("pack_url_invalid");
  return url;
}

/** Validate a bounded, exact inventory before any allocation or network request. */
export function validateManifest(
  value: unknown,
  development = false,
  distribution: ReleaseDistribution | null = null,
): PackManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RuntimeError("pack_manifest_invalid");
  const item = value as PackManifest;
  keys(item, [
    "schema",
    "id",
    "display_name",
    "version",
    "app_versions",
    "platform",
    "architecture",
    "url",
    "archive_bytes",
    "archive_sha256",
    "installed_bytes",
    "minimum_peak_free_bytes",
    "license_refs",
    "files",
    "signing",
  ]);
  packId(item.id);
  if (
    item.schema !== "animama-feature-pack/1" ||
    typeof item.display_name !== "string" ||
    !item.display_name.length ||
    item.display_name.length > 100 ||
    !VERSION.test(item.version) ||
    !Array.isArray(item.app_versions) ||
    !item.app_versions.length ||
    item.app_versions.length > 32 ||
    !item.app_versions.every(
      (version) => typeof version === "string" && VERSION.test(version),
    ) ||
    !["darwin", "win32", "data-only"].includes(item.platform) ||
    !["arm64", "x64", "data-only"].includes(item.architecture) ||
    !integer(item.installed_bytes, 1, MAX_PACK_BYTES) ||
    !integer(item.minimum_peak_free_bytes, 1, 8 * MAX_PACK_BYTES) ||
    !Array.isArray(item.license_refs) ||
    !item.license_refs.length ||
    item.license_refs.length > 1024 ||
    !item.license_refs.every(
      (ref) => typeof ref === "string" && ref.length > 0 && ref.length <= 240,
    ) ||
    !Array.isArray(item.files) ||
    !item.files.length ||
    item.files.length > MAX_ENTRIES ||
    !integer(item.archive_bytes, 1, MAX_PACK_BYTES) ||
    !SHA.test(item.archive_sha256)
  )
    throw new RuntimeError("pack_manifest_invalid");
  downloadUrl(item.url, { development, distribution });
  // Packs carry data only: no platform build, publisher or executable file.
  if (
    item.signing !== null ||
    item.platform !== "data-only" ||
    item.architecture !== "data-only"
  )
    throw new RuntimeError("pack_manifest_invalid");
  const names = new Map<string, string>();
  const files = new Set<string>();
  let total = 0;
  let previous = "";
  for (const file of item.files) {
    keys(file, ["path", "size_bytes", "sha256", "media_type", "mode"]);
    portablePath(file.path);
    if (
      file.path <= previous ||
      file.path === PACK_METADATA ||
      !integer(file.size_bytes, 0, MAX_PACK_BYTES) ||
      !SHA.test(file.sha256) ||
      typeof file.media_type !== "string" ||
      !/^[\w.+-]+\/[\w.+-]+(?:; charset=utf-8)?$/u.test(file.media_type) ||
      file.mode !== "0644"
    )
      throw new RuntimeError("pack_manifest_invalid");
    previous = file.path;
    files.add(file.path);
    const parts = file.path.split("/");
    for (let count = 1; count <= parts.length; count++) {
      const part = parts.slice(0, count).join("/");
      const key = pathKey(part);
      if (
        (names.has(key) && names.get(key) !== part) ||
        (count < parts.length && files.has(part))
      )
        throw new RuntimeError("pack_path_collision");
      names.set(key, part);
    }
    total += file.size_bytes;
  }
  if (total !== item.installed_bytes || names.size > MAX_ENTRIES)
    throw new RuntimeError("pack_manifest_invalid");
  return item;
}

export async function readBoundedJson(
  file: string,
  maximum = MAX_CATALOG_BYTES,
): Promise<unknown> {
  const metadata = await lstat(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size > maximum
  )
    throw new RuntimeError("pack_manifest_invalid");
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * The update policy sealed beside the catalog names the build's transport.
 * Every staged runtime has one; only an unpackaged runtime without it falls
 * back to the generic GitHub rule.
 */
async function sealedDistribution(
  runtimeRoot: string,
): Promise<ReleaseDistribution | null> {
  let policy: unknown;
  try {
    policy = await readBoundedJson(
      path.join(runtimeRoot, "update-policy.json"),
      4096,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new RuntimeError("pack_catalog_invalid");
  }
  const distribution = (policy as { distribution?: unknown } | null)
    ?.distribution;
  if (!isReleaseDistribution(distribution))
    throw new RuntimeError("pack_catalog_invalid");
  return distribution;
}

/** A development catalog is explicit and forbidden in a packaged application. */
export async function loadPackCatalog(options: {
  runtimeRoot: string;
  appVersion: string;
  isPackaged: boolean;
  fixturePath?: string;
}): Promise<PackCatalog> {
  if (
    options.fixturePath &&
    (options.isPackaged || !path.isAbsolute(options.fixturePath))
  )
    throw new RuntimeError("development_override_forbidden");
  const development = Boolean(options.fixturePath);
  const distribution = await sealedDistribution(options.runtimeRoot);
  const raw = (await readBoundedJson(
    options.fixturePath ?? path.join(options.runtimeRoot, "pack-catalog.json"),
  )) as Record<string, unknown>;
  const { id, ...body } = raw;
  if (
    id !== createHash("sha256").update(JSON.stringify(body)).digest("hex") ||
    body.schema !== "animama-pack-catalog/1" ||
    body.app_version !== options.appVersion ||
    !Array.isArray(body.entries) ||
    body.entries.length > featurePackIds.length
  )
    throw new RuntimeError("pack_catalog_invalid");
  const entries = body.entries.map((entry) =>
    validateManifest(entry, development, distribution),
  );
  if (
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    entries.some(
      (entry) =>
        !entry.app_versions.includes(options.appVersion) ||
        (entry.platform !== "data-only" &&
          (entry.platform !== process.platform ||
            entry.architecture !== process.arch)),
    )
  )
    throw new RuntimeError("pack_catalog_incompatible");
  return { entries, development, distribution };
}
