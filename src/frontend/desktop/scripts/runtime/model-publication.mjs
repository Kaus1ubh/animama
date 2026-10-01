import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { readJson, repoRoot, sha256, sourceRoot } from "./common.mjs";
import {
  modelInputSpec,
  modelManifest,
  resolveModelInputs,
  verifyInputs,
} from "./optional-inputs.mjs";
import { PublicationError, verifyScanReceipt } from "./publication.mjs";
import {
  verifyArtifactIndex,
  writeArtifactIndex,
} from "./release-artifacts.mjs";
import {
  IMMUTABLE,
  keyPath,
  r2Exists,
  r2Writer,
  transferTimeoutMs,
  verifyPublicObject,
} from "./r2-objects.mjs";

/**
 * Versionless model objects: every file is addressed by its own SHA-256, so a
 * published file never changes and an unchanged file is never uploaded again.
 */
export const modelKey = (modelId, file) =>
  `models/${modelId}/${file.sha256}/${file.name}`;

export const defaultCatalogFile = path.join(
  repoRoot,
  "src/backend/animama/resources/model-assets.v1.json",
);

/** The R2 bucket and public origin recorded in the reviewed release policy. */
export function modelDistribution(
  policy = readJson(path.join(sourceRoot, "release-policy.json")),
) {
  const { base_url: baseUrl, bucket } = policy.distributions?.r2 ?? {};
  const origin = baseUrl ? new URL(baseUrl).origin : "";
  if (!origin.startsWith("https://") || !bucket)
    throw new PublicationError("The release policy has no R2 distribution");
  return { origin, bucket };
}

/** The tracked manifest's files plus the manifest itself, in index form. */
function trackedFiles(modelId, manifestFile) {
  const spec = modelInputSpec(modelId);
  if (!spec)
    throw new PublicationError(`No tracked model set is named ${modelId}`);
  const manifest = modelManifest(spec, manifestFile);
  return {
    spec,
    manifest,
    files: [
      ...manifest.files.map((item) => ({
        name: item.path,
        size_bytes: item.size,
        sha256: item.sha256,
      })),
      {
        name: "manifest.json",
        size_bytes: lstatSync(manifestFile).size,
        sha256: sha256(manifestFile),
      },
    ].sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

/**
 * Every file the backend asset catalog pins: a single-file entry, or each file
 * of a multi-file set (which also names the file it installs).
 */
export function catalogFileReferences(catalog) {
  return catalog.assets.flatMap((asset) =>
    Array.isArray(asset.files)
      ? asset.files.map((file) => ({
          url: file.url,
          sha256: file.sha256,
          size: file.size,
          name: file.path,
        }))
      : [{ url: asset.url, sha256: asset.sha256, size: asset.size }],
  );
}

/** A comparable form of index entries: name, size and digest only. */
const shape = (files) =>
  JSON.stringify(
    files.map((file) => [file.name, file.size_bytes, file.sha256]),
  );

/**
 * Copy a verified model-store set and its manifest into a scannable candidate
 * directory with a release artifact index. The store is resolved offline; this
 * never downloads.
 */
export function stageModelCandidate({
  modelId,
  directory,
  modelRoot,
  manifestFile = path.join(repoRoot, "models", modelId, "manifest.json"),
}) {
  const { spec, manifest, files } = trackedFiles(modelId, manifestFile);
  let source;
  try {
    source = resolveModelInputs(spec, manifestFile, modelRoot);
    if (source) verifyInputs(spec, source, manifest);
  } catch (error) {
    // Validation messages name model files and commands. Filesystem errors
    // (which carry a code) can include host paths, so they stay generic.
    throw new PublicationError(
      error.code
        ? `The local ${spec.label} set could not be read; run python3 ${spec.script} verify`
        : error.message,
    );
  }
  if (!source)
    throw new PublicationError(
      `Acquire the set first: python3 ${spec.script} acquire`,
    );
  mkdirSync(path.dirname(directory), { recursive: true });
  const temporary = mkdtempSync(
    path.join(path.dirname(directory), `.${modelId}-`),
  );
  try {
    // APFS clones make these copies free; other filesystems fall back to a copy.
    for (const item of manifest.files)
      copyFileSync(
        path.join(source, item.path),
        path.join(temporary, item.path),
        constants.COPYFILE_FICLONE,
      );
    copyFileSync(manifestFile, path.join(temporary, "manifest.json"));
    const index = writeArtifactIndex(
      temporary,
      null,
      files.map((file) => file.name),
      { model_id: modelId },
    );
    // Hash the copies too: a concurrent store mutation must never be published.
    if (shape(index.files) !== shape(files))
      throw new PublicationError(
        "The staged model files differ from the tracked manifest",
      );
    rmSync(directory, { recursive: true, force: true });
    renameSync(temporary, directory);
    return index;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * The objects to publish for a staged candidate. The candidate must match the
 * tracked manifest exactly. Backend assets and complete desktop model-pack
 * inventories must pin these same objects. Base Parakeet also has an operator
 * acquisition consumer, which derives its complete inventory from the manifest
 * without adding artificial in-app asset entries.
 */
export function planModelPublication({
  modelId,
  directory,
  origin,
  manifestFile = path.join(repoRoot, "models", modelId, "manifest.json"),
  catalog = readJson(defaultCatalogFile),
  packCatalog = { entries: [] },
}) {
  const { files } = trackedFiles(modelId, manifestFile);
  let index;
  try {
    index = verifyArtifactIndex(directory);
  } catch {
    throw new PublicationError(
      "The staged candidate is missing or changed; stage it again",
    );
  }
  if (index.model_id !== modelId || shape(index.files) !== shape(files))
    throw new PublicationError(
      "The staged candidate does not match the tracked manifest; stage it again",
    );
  return modelObjectsForManifest({
    modelId,
    manifestFile,
    origin,
    catalog,
    packCatalog,
  });
}

/** Validate consumer pins using metadata only, before the runtime is sealed. */
export function modelObjectsForManifest({
  modelId,
  manifestFile,
  origin,
  catalog,
  packCatalog,
}) {
  const { files } = trackedFiles(modelId, manifestFile);
  const planned = files.map((file) => ({
    ...file,
    key: modelKey(modelId, file),
    url: `${origin}/${keyPath(modelKey(modelId, file))}`,
  }));
  const prefix = `${origin}/models/${modelId}/`;
  const inModel = (url) => typeof url === "string" && url.startsWith(prefix);
  const pinned = catalogFileReferences(catalog).filter((file) =>
    inModel(file.url),
  );
  // A backend asset set, like a model pack, installs the whole reviewed set.
  const sets = catalog.assets.filter(
    (asset) =>
      Array.isArray(asset.files) &&
      asset.files.some((file) => inModel(file.url)),
  );
  const packs = packCatalog.entries.filter(
    (pack) =>
      pack.schema === "animama-model-pack/1" && pack.model_id === modelId,
  );
  const payload = planned.filter((file) => file.name !== "manifest.json");
  const matches = (url, digest, size, name) =>
    planned.some(
      (file) =>
        file.url === url &&
        file.sha256 === digest &&
        file.size_bytes === size &&
        (name === undefined || file.name === name),
    );
  const invalidPack = packs.some((pack) => {
    // A model pack delivers the whole reviewed set, including its notices.
    const inventory = pack.files
      .map((file) => ({
        name: file.path,
        size_bytes: file.size_bytes,
        sha256: file.sha256,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    return (
      shape(inventory) !== shape(payload) ||
      pack.files.some(
        (file) => !matches(file.url, file.sha256, file.size_bytes, file.path),
      )
    );
  });
  const invalidSet = sets.some(
    (asset) =>
      shape(
        asset.files
          .map((file) => ({
            name: file.path,
            size_bytes: file.size,
            sha256: file.sha256,
          }))
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
      ) !== shape(payload),
  );
  const hasConsumer =
    pinned.length > 0 || packs.length > 0 || modelId === "parakeet-tdt-0.6b-v2";
  if (
    !hasConsumer ||
    invalidPack ||
    invalidSet ||
    pinned.some((file) => !matches(file.url, file.sha256, file.size, file.name))
  )
    throw new PublicationError(
      "The packaged catalog does not match this model's objects; update the catalog or the manifest",
    );
  return planned;
}

/**
 * Publish planned model objects create-only. An object the bucket already
 * holds is never uploaded again; every object, new or existing, is then
 * verified anonymously as the exact uncompressed bytes the app's downloader
 * requires. Returns each key's outcome.
 */
export async function publishModelObjects({
  directory,
  planned,
  bucket,
  credentials,
  fetch: fetchImpl = fetch,
  retryDelayMs = 5_000,
}) {
  verifyScanReceipt(
    directory,
    planned.map(({ name, sha256: digest }) => ({ name, sha256: digest })),
  );
  const put = r2Writer({ bucket, credentials, fetch: fetchImpl });
  const exists = r2Exists({ bucket, credentials, fetch: fetchImpl });
  const outcomes = [];
  for (const file of planned) {
    const timeoutMs = transferTimeoutMs(file.size_bytes);
    // The bucket, not the public domain, decides: a stale edge 404 must never
    // cause an existing object (such as a 1.24 GB encoder) to be re-sent.
    const present = await exists(file.key);
    if (!present)
      await put(file.key, path.join(directory, file.name), file.sha256, {
        createOnly: true,
        cacheControl: IMMUTABLE,
        timeoutMs,
      });
    await verifyPublicObject({
      url: file.url,
      sha256: file.sha256,
      size: file.size_bytes,
      identity: true,
      fetch: fetchImpl,
      retryDelayMs,
      timeoutMs,
    });
    outcomes.push({
      key: file.key,
      outcome: present ? "already published" : "uploaded",
    });
  }
  return outcomes;
}
