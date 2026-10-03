import path from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";
import { assertInventory, inventoryId, inventoryTree } from "./inventory.mjs";
import {
  embedRedistributionReview,
  verifyRedistributionReview,
} from "./release-policy.mjs";
import {
  hasEmbeddedSignature,
  portableExecutables,
  readSignatures,
  signatureEntry,
  signFiles,
  signingOrder,
} from "./windows-signing.mjs";

/**
 * Sign a packaged Windows app in place, before electron-builder builds its
 * uninstaller and installer (proposal P-b). Every PE file without a valid
 * signature is signed and valid vendor signatures are kept. Nested code is
 * signed first; the runtime manifest is then re-inventoried, since signing
 * changes file hashes; the outer app, `Animama.exe` last, is signed after it.
 *
 * A signing rehearsal signs the same files but carries no redistribution
 * receipt, so the release gate never accepts its output.
 */
export function signWindowsApp(app, { release, tools, rehearsal }) {
  const publisher = release.windowsPublisher;
  const runtime = path.join(app, "resources/runtime");
  const manifest = readJson(path.join(runtime, "manifest.json"));
  assertInventory(runtime, manifest.files);
  if (!rehearsal) verifyRedistributionReview(runtime, release);
  const stageBuildId = manifest.build_id;
  const files = portableExecutables(app);
  const before = readSignatures(app, files);
  const { nested, outer } = signingOrder(files);
  const unsigned = (list) =>
    list.filter((file) => !hasEmbeddedSignature(before.get(file)));
  const absolute = (list) => list.map((file) => path.join(app, file));
  const ours = new Set([...unsigned(nested), ...unsigned(outer)]);

  signFiles(absolute(unsigned(nested)), tools, publisher);
  if (!rehearsal) embedRedistributionReview(runtime, release);
  manifest.files = inventoryTree(runtime);
  manifest.build_id = inventoryId(manifest.files);
  writeJson(path.join(runtime, "manifest.json"), manifest);
  assertInventory(runtime, manifest.files);
  signFiles(absolute(unsigned(outer)), tools, publisher);

  const after = readSignatures(app, files);
  return {
    stage_build_id: stageBuildId,
    runtime_build_id: manifest.build_id,
    files: files.map((file) =>
      signatureEntry(
        file,
        sha256(path.join(app, file)),
        after.get(file),
        publisher,
        ours.has(file),
      ),
    ),
  };
}

/** electron-builder's signing hook for the uninstaller and installer it builds. */
export function signBuilderFile(file, { release, tools }) {
  signFiles([file], tools, release.windowsPublisher);
  const name = path.basename(file);
  return signatureEntry(
    name,
    sha256(file),
    readSignatures(path.dirname(file), [name]).get(name),
    release.windowsPublisher,
    true,
  );
}
