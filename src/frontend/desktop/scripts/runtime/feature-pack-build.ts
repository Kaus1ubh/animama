import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdCompress } from "node:zlib";
import {
  featurePackIds,
  type FeaturePackId,
} from "../../../shared/desktop-runtime.js";
import {
  portablePath,
  requiredFreeBytes,
  validateManifest,
  type PackFile,
  type PackManifest,
} from "../../src/main-process/feature-packs/catalog.js";
import {
  hashFile,
  realDirectory,
} from "../../src/main-process/feature-packs/files.js";
import { extractPack } from "../../src/main-process/feature-packs/extract.js";
import { verifyExecutablePack } from "../../src/main-process/feature-packs/signature.js";

type ReleaseInputs = {
  release_base_url: string;
  macos: { team_id: string | null; designated_requirement: string | null };
  packs: Record<
    FeaturePackId,
    {
      /** Deferred packs remain supported by the runtime but never enter this release catalog. */
      release_status: "active" | "deferred";
      version: string;
      /** Reusing the exact manifest across explicitly tested app versions preserves installed pointers. */
      app_versions?: string[];
      /** Immutable original release containing these bytes; defaults to this app's release. */
      release_tag?: string;
      approved_inventory_sha256: string | null;
      license_refs: string[];
    }
  >;
};
const titles: Record<FeaturePackId, string> = {
  "parakeet-stt": "Offline speech recognition",
  "expanded-included-content": "Expanded Included content",
  "document-processing": "Document processing",
};
const parakeetFiles = new Set([
  "ATTRIBUTION.md",
  "README.md",
  "encoder-model.int8.onnx",
  "decoder_joint-model.int8.onnx",
  "nemo128.onnx",
  "vocab.txt",
  "config.json",
]);

/** Inspect immutable staged inputs, retaining mode and hash rather than file-name guesses. */
export async function inventoryPack(
  root: string,
  id: FeaturePackId,
): Promise<PackFile[]> {
  await realDirectory(root);
  const files: PackFile[] = [];
  const visit = async (relative: string): Promise<void> => {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      portablePath(key);
      const file = path.join(root, key);
      const metadata = await lstat(file);
      if (
        metadata.isSymbolicLink() ||
        (!metadata.isFile() && !metadata.isDirectory())
      )
        throw new Error("Nonregular pack input");
      if (metadata.isDirectory()) {
        await visit(key);
        continue;
      }
      // The input review note is not part of the model/configuration release.
      if (id === "parakeet-stt" && key === "PACK-REVIEW.txt") continue;
      if (id === "parakeet-stt" && !parakeetFiles.has(key))
        throw new Error("Unexpected Parakeet payload");
      if (metadata.nlink !== 1) throw new Error("Hardlinked pack input");
      const media =
        path.extname(name) === ".json"
          ? "application/json"
          : [".md", ".txt"].includes(path.extname(name))
            ? "text/plain; charset=utf-8"
            : "application/octet-stream";
      files.push({
        path: key,
        size_bytes: metadata.size,
        sha256: await hashFile(file),
        media_type: media,
        mode:
          id === "document-processing" && metadata.mode & 0o111
            ? "0755"
            : "0644",
      });
      if (files.length > 100_000) throw new Error("Pack inventory too large");
    }
  };
  await visit("");
  if (id === "parakeet-stt" && files.length !== parakeetFiles.size)
    throw new Error("Missing Parakeet model/configuration input");
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The writer emits only USTAR; the production installer verifies a round trip. */
export async function buildPackArchive(options: {
  root: string;
  output: string;
  manifest: Omit<
    PackManifest,
    "archive_bytes" | "archive_sha256" | "minimum_peak_free_bytes"
  >;
  writeTar(source: string, files: PackFile[], output: string): Promise<void>;
  development?: boolean;
}): Promise<PackManifest> {
  const tar = `${options.output}.tar.partial`;
  const compressed = `${options.output}.partial`;
  const verify = `${options.output}.verify`;
  try {
    await options.writeTar(options.root, options.manifest.files, tar);
    await pipeline(
      createReadStream(tar),
      createZstdCompress(),
      createWriteStream(compressed, { flags: "wx" }),
    );
    const manifest = validateManifest(
      {
        ...options.manifest,
        archive_bytes: (await lstat(compressed)).size,
        archive_sha256: await hashFile(compressed),
        minimum_peak_free_bytes: 1,
      },
      options.development,
    );
    manifest.minimum_peak_free_bytes = requiredFreeBytes(manifest);
    await extractPack(
      compressed,
      verify,
      manifest,
      new AbortController().signal,
    );
    await verifyExecutablePack(verify, manifest);
    await rename(compressed, options.output);
    return manifest;
  } finally {
    await rm(tar, { force: true });
    await rm(compressed, { force: true });
    await rm(verify, { recursive: true, force: true });
  }
}

/** Never advertise unreviewed inputs or a mutable "latest" endpoint as installable. */
export async function buildFeaturePacks(options: {
  inputs: Record<FeaturePackId, string>;
  output: string;
  catalog: string;
  appVersion: string;
  release: ReleaseInputs;
  budgets: Record<
    FeaturePackId,
    { installed_bytes: number; download_bytes: number | null }
  >;
  writeTar(source: string, files: PackFile[], output: string): Promise<void>;
}): Promise<{ id: string; entries: PackManifest[] }> {
  // Validate the fixed release contract before its values form filesystem paths.
  const versionPattern = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/u;
  if (
    !versionPattern.test(options.appVersion) ||
    !/^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/releases\/download\/[^/?#]+$/u.test(
      options.release.release_base_url,
    )
  )
    throw new Error("Invalid fixed pack release configuration");
  for (const id of featurePackIds) {
    const release = options.release.packs[id];
    if (
      !release ||
      !["active", "deferred"].includes(release.release_status) ||
      !versionPattern.test(release.version) ||
      (release.app_versions !== undefined &&
        (!Array.isArray(release.app_versions) ||
          release.app_versions.length > 32 ||
          !release.app_versions.includes(options.appVersion) ||
          new Set(release.app_versions).size !== release.app_versions.length ||
          release.app_versions.some(
            (version) =>
              typeof version !== "string" || !versionPattern.test(version),
          ))) ||
      (release.release_tag !== undefined &&
        (typeof release.release_tag !== "string" ||
          !/^v\d{1,5}\.\d{1,5}\.\d{1,5}$/u.test(release.release_tag))) ||
      (release.approved_inventory_sha256 !== null &&
        !/^[a-f0-9]{64}$/u.test(release.approved_inventory_sha256))
    )
      throw new Error("Invalid fixed pack release configuration");
  }
  await mkdir(options.output, { recursive: true });
  const entries: PackManifest[] = [];
  const reports = [];
  for (const id of featurePackIds) {
    const release = options.release.packs[id];
    if (release.release_status === "deferred") {
      // A rerun after deferral must not leave this version's earlier archive
      // beside the new catalog. Only a fixed, validated derived path is removed.
      await rm(
        path.join(
          options.output,
          `${id}-${release.version}-${id === "document-processing" ? "darwin-arm64" : "data-only"}.tar.zst`,
        ),
        { force: true },
      );
      reports.push({ id, state: "deferred" });
      continue;
    }
    const root = options.inputs[id];
    if (
      !(await lstat(root)
        .then(() => true)
        .catch((error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        }))
    ) {
      reports.push({ id, state: "input_unavailable" });
      continue;
    }
    const files = await inventoryPack(root, id);
    const digest = createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex");
    const installed = files.reduce((sum, file) => sum + file.size_bytes, 0);
    if (release.approved_inventory_sha256 !== digest) {
      reports.push({
        id,
        state: "redistribution_review_required",
        inventory_sha256: digest,
        installed_bytes: installed,
      });
      continue;
    }
    if (installed > options.budgets[id].installed_bytes)
      throw new Error(`${id} exceeds its installed size ceiling`);
    const filename = `${id}-${release.version}-${id === "document-processing" ? "darwin-arm64" : "data-only"}.tar.zst`;
    const manifest = await buildPackArchive({
      root,
      output: path.join(options.output, filename),
      writeTar: options.writeTar,
      manifest: {
        schema: "animama-feature-pack/1",
        id,
        display_name: titles[id],
        version: release.version,
        app_versions: [
          ...(release.app_versions ?? [options.appVersion]),
        ].sort(),
        platform: id === "document-processing" ? "darwin" : "data-only",
        architecture: id === "document-processing" ? "arm64" : "data-only",
        url: `${release.release_tag ? options.release.release_base_url.replace(/\/[^/]+$/u, `/${release.release_tag}`) : options.release.release_base_url}/${filename}`,
        installed_bytes: installed,
        license_refs: release.license_refs,
        files,
        signing:
          id === "document-processing"
            ? {
                publisher: options.release.macos.team_id ?? "",
                requirement: options.release.macos.designated_requirement ?? "",
              }
            : null,
      },
    });
    const maximum = options.budgets[id].download_bytes;
    if (maximum !== null && manifest.archive_bytes > maximum)
      throw new Error(`${id} exceeds its download size ceiling`);
    entries.push(manifest);
    reports.push({
      id,
      state: "staged_not_published",
      inventory_sha256: digest,
      archive_sha256: manifest.archive_sha256,
      download_bytes: manifest.archive_bytes,
      installed_bytes: installed,
      minimum_peak_free_bytes: manifest.minimum_peak_free_bytes,
    });
  }
  await writeFile(
    path.join(options.output, "pack-build-report.json"),
    `${JSON.stringify({ schema: "animama-pack-build/1", reports }, null, 2)}\n`,
  );
  const body = {
    schema: "animama-pack-catalog/1",
    app_version: options.appVersion,
    entries,
    status: entries.length ? "staged-not-published" : "no-published-packs",
  };
  const id = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  await mkdir(path.dirname(options.catalog), { recursive: true });
  await writeFile(
    `${options.catalog}.partial`,
    `${JSON.stringify({ id, ...body }, null, 2)}\n`,
  );
  await rename(`${options.catalog}.partial`, options.catalog);
  return { id, entries };
}
