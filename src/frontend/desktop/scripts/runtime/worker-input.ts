import { createHash } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPackArchive, inventoryPack } from "./feature-pack-build.js";
import {
  readBoundedJson,
  validateManifest,
} from "../../src/main-process/feature-packs/catalog.js";
import { extractPack } from "../../src/main-process/feature-packs/extract.js";
import { hashFile } from "../../src/main-process/feature-packs/files.js";
import { verifyExecutablePack } from "../../src/main-process/feature-packs/signature.js";

type Options = {
  root: string;
  exchange: string;
  appVersion: string;
  release: {
    release_base_url: string;
    macos: { team_id: string; designated_requirement: string };
    packs: {
      "document-processing": {
        version: string;
        approved_inventory_sha256: string | null;
        license_refs: string[];
      };
    };
  };
  writeTar: Parameters<typeof buildPackArchive>[0]["writeTar"];
};

/** Export an UNAPPROVED candidate for human inventory review; never write an approval or a core catalog. */
export async function exportWorkerInput(options: Options): Promise<void> {
  await mkdir(options.exchange, { recursive: true });
  const files = await inventoryPack(options.root, "document-processing");
  const release = options.release.packs["document-processing"];
  const manifest = await buildPackArchive({
    root: options.root,
    output: path.join(options.exchange, "document-worker-input.tar.zst"),
    writeTar: options.writeTar,
    manifest: {
      schema: "animama-feature-pack/1",
      id: "document-processing",
      display_name: "Document processing",
      version: release.version,
      app_versions: [options.appVersion],
      platform: "darwin",
      architecture: "arm64",
      url: `${options.release.release_base_url}/document-processing-${release.version}-darwin-arm64.tar.zst`,
      installed_bytes: files.reduce((sum, file) => sum + file.size_bytes, 0),
      license_refs: release.license_refs,
      signing: {
        publisher: options.release.macos.team_id,
        requirement: options.release.macos.designated_requirement,
      },
      files,
    },
  });
  await writeFile(
    path.join(options.exchange, "document-worker-input.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    path.join(options.exchange, "worker-review.json"),
    JSON.stringify(
      {
        schema: "animama-worker-review/1",
        release_approved: false,
        inventory_sha256: createHash("sha256")
          .update(JSON.stringify(files))
          .digest("hex"),
        archive_sha256: manifest.archive_sha256,
        installed_bytes: manifest.installed_bytes,
        download_bytes: manifest.archive_bytes,
      },
      null,
      2,
    ) + "\n",
  );
}

/** A CI artifact is untrusted until its exact inventory, archive and OS publisher all match review. */
export async function importWorkerInput(options: Options): Promise<void> {
  const manifest = validateManifest(
    await readBoundedJson(
      path.join(options.exchange, "document-worker-input.json"),
    ),
  );
  const release = options.release.packs["document-processing"];
  if (
    manifest.id !== "document-processing" ||
    manifest.version !== release.version ||
    manifest.signing?.publisher !== options.release.macos.team_id ||
    manifest.signing?.requirement !==
      options.release.macos.designated_requirement ||
    createHash("sha256")
      .update(JSON.stringify(manifest.files))
      .digest("hex") !== release.approved_inventory_sha256
  )
    throw new Error(
      "Worker candidate does not match the exact reviewed inventory and publisher",
    );
  const archive = path.join(options.exchange, "document-worker-input.tar.zst");
  const stat = await lstat(archive);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size !== manifest.archive_bytes ||
    (await hashFile(archive)) !== manifest.archive_sha256
  )
    throw new Error("Worker candidate archive changed");
  const temporary = `${options.root}.importing`;
  await rm(temporary, { recursive: true, force: true });
  try {
    await extractPack(
      archive,
      temporary,
      manifest,
      new AbortController().signal,
    );
    await verifyExecutablePack(temporary, manifest);
    // Only replace derived build inputs after complete verification. Installed packs are elsewhere.
    await rm(options.root, { recursive: true, force: true });
    await rename(temporary, options.root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
