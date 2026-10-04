import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { filesIn, readJson, repoRoot, sha256 } from "./common.mjs";
import { assertPortablePath, inventoryId } from "./inventory.mjs";
import { modelInputSpec } from "./optional-inputs.mjs";
import {
  catalogFileReferences,
  modelDistribution,
  modelObjectsForManifest,
  planModelPublication,
  stageModelCandidate,
  verifiedModelSource,
} from "./model-publication.mjs";
import { PublicationError, verifyScanReceipt } from "./publication.mjs";
import { releaseName, verifyArtifactIndex } from "./release-artifacts.mjs";

/** The signing report each target's candidate carries. */
const SIGNING_SCHEMAS = {
  "darwin-arm64": "animama-macos-signing/1",
  "win32-x64": "animama-windows-signing/1",
};

const manifestPath = (id) => `model-manifests/${id}.json`;
const backendCatalogPath = (names) => {
  const matching = names.filter(
    (name) =>
      name.startsWith("backend/") &&
      name.endsWith("/animama/resources/model-assets.v1.json"),
  );
  if (matching.length !== 1)
    throw new PublicationError(
      "The runtime must seal exactly one frozen backend model catalog",
    );
  return matching[0];
};
const sameNames = (actual, expected) =>
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

/**
 * The backend asset catalog's URLs, not checkout selection or optional cache
 * availability, own membership: every model set it pins (including both
 * Parakeet sets) must be published.
 */
function requiredModels(catalog, origin) {
  if (
    catalog.schema !== "animama-asset-catalog/1" ||
    !Array.isArray(catalog.assets)
  )
    throw new PublicationError("Invalid release model catalog");
  const ids = new Set();
  for (const { url } of catalogFileReferences(catalog)) {
    if (typeof url !== "string" || !url.startsWith(`${origin}/models/`))
      throw new PublicationError(
        "A release model URL differs from the shared object origin",
      );
    const match =
      /^([^/]+)\/[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/u.exec(
        url.slice(`${origin}/models/`.length),
      );
    const id = match?.[1];
    if (!id || !modelInputSpec(id))
      throw new PublicationError(
        "A release model catalog names an unknown model set",
      );
    ids.add(id);
  }
  return [...ids].sort();
}

/** Copy metadata only; normal staging never requires optional voice/encoder bytes. */
export function sealReleaseModelManifests({
  runtime,
  manifestsDirectory = path.join(repoRoot, "models"),
}) {
  const catalog = readJson(
    path.join(runtime, backendCatalogPath(filesIn(runtime))),
  );
  const { origin } = modelDistribution();
  const ids = requiredModels(catalog, origin);
  // Validate all references before replacing any previously staged metadata.
  for (const modelId of ids)
    modelObjectsForManifest({
      modelId,
      manifestFile: path.join(manifestsDirectory, modelId, "manifest.json"),
      origin,
      catalog,
    });
  const target = path.join(runtime, "model-manifests");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const modelId of ids)
    copyFileSync(
      path.join(manifestsDirectory, modelId, "manifest.json"),
      path.join(runtime, manifestPath(modelId)),
    );
  return ids;
}

function assertRuntimeIdentity(manifest) {
  if (
    manifest.schema !== "animama-desktop-runtime/2" ||
    !Array.isArray(manifest.files) ||
    manifest.build_id !== inventoryId(manifest.files)
  )
    throw new PublicationError("Release runtime identity mismatch");
  let previous = "";
  const names = new Set();
  for (const file of manifest.files) {
    assertPortablePath(file.path);
    if (file.path <= previous || names.has(file.path.toLowerCase()))
      throw new PublicationError(
        "Release runtime inventory is not unique and sorted",
      );
    names.add(file.path.toLowerCase());
    previous = file.path;
  }
}

function assertSealedFile(manifest, relative, file) {
  const sealed = manifest.files.filter((item) => item.path === relative);
  let valid = false;
  try {
    const stat = lstatSync(file);
    valid =
      sealed.length === 1 &&
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      stat.size === sealed[0].size_bytes &&
      sha256(file) === sealed[0].sha256;
  } catch {
    /* A missing file is the same failed binding as changed bytes. */
  }
  if (!valid)
    throw new PublicationError(
      "Release model metadata differs from the sealed runtime binding",
    );
}

function boundModels({
  manifest,
  catalogFile,
  packCatalogFile,
  origin,
  modelManifestFile,
}) {
  assertRuntimeIdentity(manifest);
  assertSealedFile(
    manifest,
    backendCatalogPath(manifest.files.map((file) => file.path)),
    catalogFile,
  );
  assertSealedFile(manifest, "pack-catalog.json", packCatalogFile);
  const catalog = readJson(catalogFile);
  const packCatalog = readJson(packCatalogFile);
  const { id, ...body } = packCatalog;
  if (
    id !== manifest.pack_catalog_id ||
    id !== createHash("sha256").update(JSON.stringify(body)).digest("hex") ||
    packCatalog.app_version !== manifest.app_version
  )
    throw new PublicationError(
      "Release pack catalog identity differs from the runtime binding",
    );
  const ids = requiredModels(catalog, origin);
  if (
    !sameNames(
      manifest.files
        .filter((file) => file.path.startsWith("model-manifests/"))
        .map((file) => file.path),
      ids.map(manifestPath),
    )
  )
    throw new PublicationError(
      "Release model manifest membership differs from its catalogs",
    );
  for (const modelId of ids) {
    const manifestFile = modelManifestFile(modelId);
    assertSealedFile(manifest, manifestPath(modelId), manifestFile);
    modelObjectsForManifest({
      modelId,
      manifestFile,
      origin,
      catalog,
    });
  }
  return { ids, catalog };
}

/** The model sets a staged or signed runtime requires, bound to its catalogs. */
function runtimeModels(runtime) {
  const manifest = readJson(path.join(runtime, "manifest.json"));
  const catalogFile = path.join(
    runtime,
    backendCatalogPath(manifest.files.map((file) => file.path)),
  );
  const { ids } = boundModels({
    manifest,
    catalogFile,
    packCatalogFile: path.join(runtime, "pack-catalog.json"),
    origin: modelDistribution().origin,
    modelManifestFile: (id) => path.join(runtime, manifestPath(id)),
  });
  return { ids, catalogFile };
}

/**
 * Prove, without copying, that every model set the runtime requires is
 * acquired locally and verifies, so a missing set cannot waste a build.
 */
export function verifyReleaseModels({ runtime, modelRoot }) {
  for (const modelId of runtimeModels(runtime).ids)
    verifiedModelSource({
      modelId,
      modelRoot,
      manifestFile: path.join(runtime, manifestPath(modelId)),
    });
}

/** Called only after the caller verifies the actual signed app and runtime inventory. */
export function stageReleaseModels({ runtime, directory, modelRoot }) {
  const { ids, catalogFile } = runtimeModels(runtime);
  mkdirSync(directory, { recursive: true });
  copyFileSync(catalogFile, path.join(directory, "backend-model-assets.json"));
  const models = path.join(directory, "models");
  // This private publish subtree contains derived candidates only, never the shared cache.
  rmSync(models, { recursive: true, force: true });
  mkdirSync(models);
  for (const modelId of ids)
    stageModelCandidate({
      modelId,
      directory: path.join(models, modelId),
      modelRoot,
      manifestFile: path.join(runtime, manifestPath(modelId)),
    });
  return ["backend-model-assets.json"];
}

/**
 * Validate all signed bindings and model bytes before scanning; no receipts
 * are bypassed. The backend catalog keeps its shared name on every target.
 */
export function releaseModelCandidates({
  directory,
  origin,
  target = "darwin-arm64",
}) {
  const index = verifyArtifactIndex(directory, target);
  const named = (name) => releaseName(target, name);
  const required = [
    named("runtime-manifest.json"),
    named("pack-catalog.json"),
    "backend-model-assets.json",
    named("signing-report.json"),
  ];
  if (required.some((name) => !index.files.some((file) => file.name === name)))
    throw new PublicationError(
      "The release artifact index omits required model binding metadata",
    );
  const manifest = readJson(path.join(directory, required[0]));
  const signing = readJson(path.join(directory, required[3]));
  if (
    index.runtime_build_id !== manifest.build_id ||
    index.app_version !== manifest.app_version ||
    signing.schema !== SIGNING_SCHEMAS[target] ||
    signing.runtime_build_id !== manifest.build_id ||
    signing.app_version !== manifest.app_version
  )
    throw new PublicationError(
      "Release model signing/runtime identity mismatch",
    );
  const { ids, catalog } = boundModels({
    manifest,
    catalogFile: path.join(directory, "backend-model-assets.json"),
    packCatalogFile: path.join(directory, required[1]),
    origin,
    modelManifestFile: (id) =>
      path.join(directory, "models", id, "manifest.json"),
  });
  const models = path.join(directory, "models");
  let exact = false;
  try {
    const stat = lstatSync(models);
    exact =
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      sameNames(readdirSync(models), ids) &&
      ids.every((id) => {
        const entry = lstatSync(path.join(models, id));
        return entry.isDirectory() && !entry.isSymbolicLink();
      });
  } catch {
    /* Missing or linked candidates cannot satisfy catalog membership. */
  }
  if (!exact)
    throw new PublicationError(
      "Release model candidate membership differs from the signed catalogs",
    );
  return ids.map((modelId) => {
    const modelDirectory = path.join(models, modelId);
    const planned = planModelPublication({
      modelId,
      directory: modelDirectory,
      origin,
      manifestFile: path.join(modelDirectory, "manifest.json"),
      catalog,
    });
    return { modelId, directory: modelDirectory, planned };
  });
}

/** All required model inventories and scans pass before the first remote operation. */
export function planReleaseModels(options) {
  const models = releaseModelCandidates(options);
  for (const model of models) verifyScanReceipt(model.directory, model.planned);
  return models;
}
