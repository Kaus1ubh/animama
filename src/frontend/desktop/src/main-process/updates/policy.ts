import {
  featurePackIds,
  type FeaturePackId,
} from "../../../../shared/desktop-runtime.js";
import { RuntimeError } from "../runtime/errors.js";

const MAX_UPDATE_BYTES = 750 * 1024 ** 2;
const MAX_INSTALLED_BYTES = 1536 * 1024 ** 2;
const UPDATE_RESERVE_BYTES = 256 * 1024 ** 2;
export type UpdatePolicy = {
  schema: "animama-update-policy/1";
  github: { owner: string; repo: string };
  channel: "stable";
  team_id: string;
};
export type UpdateCandidate = {
  version: string;
  filename: string;
  sha512: string;
  downloadBytes: number;
  installedBytes: number;
  runtimeBuildId: string;
  packDigests: Partial<Record<FeaturePackId, string>>;
};

const VERSION = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/u;
const HASH = /^[a-f0-9]{64}$/u;
const repositoryPart = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;

/** Stable releases only; prereleases and downgrade channels have no local switch. */
function compareVersions(left: string, right: string): number {
  if (!VERSION.test(left) || !VERSION.test(right))
    throw new RuntimeError("update_metadata_invalid");
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  return 0;
}

/** Read only the non-secret policy embedded in verified application resources. */
export function validateUpdatePolicy(value: unknown): UpdatePolicy {
  const policy = value as UpdatePolicy;
  if (
    !policy ||
    policy.schema !== "animama-update-policy/1" ||
    policy.channel !== "stable" ||
    !policy.github ||
    typeof policy.github.owner !== "string" ||
    typeof policy.github.repo !== "string" ||
    !repositoryPart.test(policy.github.owner) ||
    !repositoryPart.test(policy.github.repo) ||
    typeof policy.team_id !== "string" ||
    !/^[A-Z0-9]{10}$/u.test(policy.team_id) ||
    Object.keys(policy).sort().join(",") !== "channel,github,schema,team_id" ||
    Object.keys(policy.github).sort().join(",") !== "owner,repo"
  ) {
    throw new RuntimeError("updates_not_configured");
  }
  return policy;
}

/** Gate untrusted feed data before disk estimates, downloads, or pack preflight. */
export function validateUpdateCandidate(
  value: unknown,
  currentVersion: string,
): UpdateCandidate {
  const info = value as Record<string, unknown>;
  if (
    !info ||
    typeof info.version !== "string" ||
    compareVersions(info.version, currentVersion) <= 0 ||
    info.tag !== `v${info.version}` ||
    !Array.isArray(info.files) ||
    info.files.length < 1 ||
    info.files.length > 2 ||
    info.minimumSystemVersion !== "24.0.0" ||
    info.stagingPercentage !== undefined
  ) {
    throw new RuntimeError("update_metadata_invalid");
  }
  const filename = `Animama-${info.version}-arm64.zip`;
  const names = new Set<string>();
  let archive: { url: string; size: number; sha512: string } | undefined;
  for (const entry of info.files) {
    const file = entry as { url: string; size: number; sha512: string };
    if (
      !file ||
      ![filename, `Animama-${info.version}-arm64.dmg`].includes(file.url) ||
      names.has(file.url) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_UPDATE_BYTES ||
      typeof file.sha512 !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/u.test(file.sha512)
    ) {
      throw new RuntimeError("update_metadata_invalid");
    }
    names.add(file.url);
    if (file.url === filename) archive = file;
  }
  const metadata = info.animama as Record<string, unknown>;
  if (
    !archive ||
    !metadata ||
    metadata.schema !== "animama-update/1" ||
    metadata.platform !== "darwin" ||
    metadata.architecture !== "arm64" ||
    !Number.isSafeInteger(metadata.installed_bytes) ||
    Number(metadata.installed_bytes) < 1 ||
    Number(metadata.installed_bytes) > MAX_INSTALLED_BYTES ||
    typeof metadata.runtime_build_id !== "string" ||
    !HASH.test(metadata.runtime_build_id) ||
    !Array.isArray(metadata.packs) ||
    metadata.packs.length > featurePackIds.length
  ) {
    throw new RuntimeError("update_metadata_invalid");
  }
  const packDigests: UpdateCandidate["packDigests"] = {};
  for (const entry of metadata.packs) {
    const pack = entry as { id: FeaturePackId; manifest_sha256: string };
    if (
      !pack ||
      !featurePackIds.includes(pack.id) ||
      packDigests[pack.id] ||
      typeof pack.manifest_sha256 !== "string" ||
      !HASH.test(pack.manifest_sha256)
    ) {
      throw new RuntimeError("update_metadata_invalid");
    }
    packDigests[pack.id] = pack.manifest_sha256;
  }
  return {
    version: info.version,
    filename,
    sha512: archive.sha512,
    downloadBytes: archive.size,
    installedBytes: Number(metadata.installed_bytes),
    runtimeBuildId: metadata.runtime_build_id,
    packDigests,
  };
}

/** Include download cache, Squirrel staging, replacement bytes and a conservative SQL snapshot. */
export function updateFreeBytes(
  candidate: UpdateCandidate,
  databaseBytes: number,
): number {
  if (!Number.isSafeInteger(databaseBytes) || databaseBytes < 0)
    throw new RuntimeError("update_disk_estimate_failed");
  const value =
    2 * candidate.downloadBytes +
    2 * candidate.installedBytes +
    2 * databaseBytes +
    UPDATE_RESERVE_BYTES;
  if (!Number.isSafeInteger(value))
    throw new RuntimeError("update_disk_estimate_failed");
  return value;
}

/** The updater's separate Electron session never contacts arbitrary or credentialed origins. */
export function allowedUpdateUrl(value: string, policy: UpdatePolicy): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      return false;
    if (
      [
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(url.hostname)
    )
      return true;
    const prefix = `/${policy.github.owner}/${policy.github.repo}/releases`;
    return (
      (url.hostname === "github.com" &&
        (url.pathname === `${prefix}.atom` ||
          url.pathname.startsWith(`${prefix}/`))) ||
      (url.hostname === "api.github.com" &&
        url.pathname.startsWith(`/repos${prefix}/`))
    );
  } catch {
    return false;
  }
}
