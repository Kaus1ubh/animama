import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_PARSED_JSON_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_PARSED_JSON_BYTES = 4 * 1024 * 1024;
const MAX_REGISTERED_FILES = 64;
const MAX_RELATIVE_PATH_LENGTH = 512;
const MAX_PATH_SEGMENT_LENGTH = 255;
const MAX_MANIFEST_LABEL_LENGTH = 128;

function isSameOrDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/** Reject roots broad enough to expose unrelated repository or user data. */
export async function validateLocalContentRoot(
  configuredRoot,
  { repositoryRoot, homeDirectory = os.homedir() },
) {
  if (typeof configuredRoot !== "string" || !path.isAbsolute(configuredRoot)) {
    throw new Error("ANIMAMA_E2E_LOCAL_CONTENT_ROOT must be an absolute path.");
  }
  const lexicalRoot = path.resolve(configuredRoot);
  const rootInfo = await lstat(lexicalRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error(
      "The Local content root must be a real directory, not a link.",
    );
  }
  const resolvedRoot = await realpath(lexicalRoot);
  const resolvedRepository = await realpath(repositoryRoot);
  let resolvedHome = path.resolve(homeDirectory);
  try {
    resolvedHome = await realpath(homeDirectory);
  } catch {
    // A synthetic test home may not exist; its lexical identity is sufficient.
  }
  const broadRoots = new Set([
    path.parse(resolvedRoot).root,
    resolvedHome,
    resolvedRepository,
    path.dirname(resolvedRepository),
  ]);
  if (broadRoots.has(resolvedRoot)) {
    throw new Error("The configured Local content root is too broad.");
  }
  if (
    isSameOrDescendant(resolvedRoot, resolvedRepository) &&
    !isSameOrDescendant(resolvedRepository, resolvedRoot)
  ) {
    throw new Error(
      "The configured Local content root contains the repository.",
    );
  }
  return resolvedRoot;
}

function validatedRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_RELATIVE_PATH_LENGTH ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error(`${label} must be a safe POSIX relative path.`);
  }
  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.length > MAX_PATH_SEGMENT_LENGTH,
    )
  ) {
    throw new Error(
      `${label} contains a traversal, empty, or overlong segment.`,
    );
  }
  return parts;
}

function boundedManifestLabel(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_MANIFEST_LABEL_LENGTH
  ) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function resolveRegisteredPath(root, relativePath, options = {}) {
  const parts = validatedRelativePath(relativePath, "Registered content path");
  const candidate = path.join(root, ...parts);
  if (!isSameOrDescendant(root, candidate) || candidate === root) {
    throw new Error("Registered content path escapes the Local root.");
  }
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (error?.code === "ENOENT" && options.allowMissing) {
        return { absolutePath: candidate, missing: true };
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(
        "Registered content paths may not traverse symbolic links.",
      );
    }
  }
  const resolved = await realpath(candidate);
  if (!isSameOrDescendant(root, resolved)) {
    throw new Error("Registered content realpath escapes the Local root.");
  }
  return { absolutePath: resolved, missing: false };
}

function validateCatalogItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(
      "Filesystem verification requires one neutral catalog item.",
    );
  }
  if (item.source !== "local" || item.origin !== "local") {
    throw new Error(
      "Filesystem verification accepts only Local catalog items.",
    );
  }
  if (item.status !== "valid") {
    throw new Error("Filesystem verification requires a valid catalog item.");
  }
  if (typeof item.item_id !== "string" || !item.item_id) {
    throw new Error("Catalog item is missing item_id.");
  }
  if (!/^[0-9a-f]{64}$/.test(item.revision_sha256 ?? "")) {
    throw new Error("Catalog item is missing a valid revision_sha256.");
  }
  validatedRelativePath(item.relative_locator, "Catalog relative_locator");
  if (
    !Array.isArray(item.files) ||
    item.files.length < 1 ||
    item.files.length > MAX_REGISTERED_FILES
  ) {
    throw new Error("Catalog item has an invalid registered file count.");
  }
}

function itemDirectoryLocator(item) {
  const locator = item.relative_locator;
  return item.files.some((file) => file?.relative_path === locator)
    ? path.posix.dirname(locator)
    : locator;
}

/** Hash exact registered files and return only bounded relative evidence. */
export async function verifyLocalCatalogItemFiles({
  item,
  localRoot,
  repositoryRoot,
}) {
  validateCatalogItem(item);
  const root = await validateLocalContentRoot(localRoot, { repositoryRoot });
  const directoryLocator = itemDirectoryLocator(item);
  if (directoryLocator === ".") {
    throw new Error("A catalog entry may not resolve to the broad Local root.");
  }
  const directory = await resolveRegisteredPath(root, directoryLocator);
  const directoryInfo = await stat(directory.absolutePath);
  if (!directoryInfo.isDirectory()) {
    throw new Error(
      "The registered catalog item directory is not a directory.",
    );
  }

  const seen = new Set();
  const manifest = [];
  const parsedJson = {};
  let parsedJsonBytes = 0;
  for (const file of item.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new Error("Catalog item contains an invalid file record.");
    }
    const relativePath = file.relative_path;
    validatedRelativePath(relativePath, "Catalog file relative_path");
    if (seen.has(relativePath)) {
      throw new Error("Catalog item contains a duplicate registered file.");
    }
    if (
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 0 ||
      !/^[0-9a-f]{64}$/.test(file.sha256 ?? "")
    ) {
      throw new Error("Catalog item contains invalid file integrity metadata.");
    }
    seen.add(relativePath);
    if (
      !isSameOrDescendant(
        path.join(root, ...directoryLocator.split("/")),
        path.join(root, ...relativePath.split("/")),
      )
    ) {
      throw new Error("A registered file escapes its exact item directory.");
    }
    const resolved = await resolveRegisteredPath(root, relativePath);
    const info = await stat(resolved.absolutePath);
    if (!info.isFile()) {
      throw new Error(
        `Registered content file ${relativePath} is not regular.`,
      );
    }
    if (info.size !== file.size_bytes) {
      throw new Error(
        `Registered content file ${relativePath} has a size mismatch.`,
      );
    }
    const sha256 = await sha256File(resolved.absolutePath);
    if (sha256 !== file.sha256) {
      throw new Error(
        `Registered content file ${relativePath} has a digest mismatch.`,
      );
    }
    manifest.push({
      relativePath,
      role: boundedManifestLabel(file.role, "Catalog file role"),
      mediaType: boundedManifestLabel(
        file.media_type,
        "Catalog file media_type",
      ),
      sizeBytes: info.size,
      sha256,
    });
    if (
      relativePath.endsWith(".json") &&
      info.size <= MAX_PARSED_JSON_BYTES &&
      parsedJsonBytes + info.size <= MAX_TOTAL_PARSED_JSON_BYTES
    ) {
      const body = await readFile(resolved.absolutePath);
      try {
        parsedJson[relativePath] = JSON.parse(body.toString("utf8"));
        parsedJsonBytes += body.length;
      } catch {
        throw new Error(`Registered JSON file ${relativePath} is invalid.`);
      }
    }
  }
  manifest.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  return {
    itemId: item.item_id,
    revisionSha256: item.revision_sha256,
    relativeLocator: item.relative_locator,
    directoryLocator,
    fileCount: manifest.length,
    manifestSha256,
    manifest,
    parsedJson,
  };
}

async function verifyRelativeArtifactAbsent({
  relativePath,
  localRoot,
  repositoryRoot,
  label,
}) {
  const root = await validateLocalContentRoot(localRoot, { repositoryRoot });
  const parts = validatedRelativePath(relativePath, label);
  const artifactLocator = relativePath;
  if (artifactLocator === ".") {
    throw new Error(`${label} resolves to the broad Local root.`);
  }
  const resolved = await resolveRegisteredPath(root, artifactLocator, {
    allowMissing: true,
  });
  if (!resolved.missing) {
    throw new Error(
      `Registered item artifact still exists for ${parts.join("/")}.`,
    );
  }
  return { relativePath, artifactLocator, absent: true };
}

/**
 * Prove a name-derived expected path is absent before Save. This read-only fact
 * is deliberately not a registered locator and never grants cleanup authority.
 */
export async function verifyExpectedLocalPathAbsent({
  expectedRelativePath,
  localRoot,
  repositoryRoot,
}) {
  return verifyRelativeArtifactAbsent({
    relativePath: expectedRelativePath,
    localRoot,
    repositoryRoot,
    label: "Expected Local content path",
  });
}

/** Prove an exact ledger-registered item directory is absent after API cleanup. */
export async function verifyLocalItemDirectoryAbsent({
  relativeLocator,
  localRoot,
  repositoryRoot,
}) {
  const proof = await verifyRelativeArtifactAbsent({
    relativePath: relativeLocator,
    localRoot,
    repositoryRoot,
    label: "Catalog relative_locator",
  });
  return {
    relativeLocator,
    artifactLocator: proof.artifactLocator,
    absent: true,
  };
}
