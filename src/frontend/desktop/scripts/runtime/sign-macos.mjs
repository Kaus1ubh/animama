import { rmSync } from "node:fs";
import path from "node:path";
import { desktopRoot, readJson, run, writeJson } from "./common.mjs";
import {
  assertInventory,
  componentInventory,
  inventoryId,
  inventoryTree,
} from "./inventory.mjs";
import {
  embedRedistributionReview,
  loadReleasePolicy,
  sealedDistribution,
  verifyRedistributionReview,
} from "./release-policy.mjs";
import {
  nestedCode,
  notarize,
  verifyAppCodeSignature,
  verifySignedApp,
} from "./macos-signing.mjs";

/**
 * Sign `Animama.app` from electron-builder's custom signing hook: update
 * runtime hashes AFTER nested signing, BEFORE sealing the app. A signing
 * rehearsal signs the same code but embeds no review receipt and submits
 * nothing to Apple, so its report is never `release_ready`.
 */
export function signMacApp(app, { rehearsal = false } = {}) {
  const release = loadReleasePolicy({ requireReview: !rehearsal });
  const runtime = path.join(app, "Contents/Resources/runtime");
  const manifest = readJson(path.join(runtime, "manifest.json"));
  assertInventory(runtime, manifest.files);
  if (!rehearsal) verifyRedistributionReview(runtime, release);
  const stageBuildId = manifest.build_id;
  const code = nestedCode(app, componentInventory(app));
  if (!code.native.length)
    throw new Error("No native code found in the release app");
  const inherited = path.join(
    desktopRoot,
    "build/entitlements.mac.inherit.plist",
  );
  const parent = path.join(desktopRoot, "build/entitlements.mac.plist");
  const signOne = (file, entitlements) =>
    run(
      "/usr/bin/codesign",
      [
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--sign",
        release.publisher.signing_identity,
        "--entitlements",
        entitlements,
        file,
      ],
      { capture: true },
    );
  for (const name of [...code.native, ...code.bundles])
    signOne(path.join(app, name), inherited);
  if (!rehearsal) embedRedistributionReview(runtime, release);
  manifest.files = inventoryTree(runtime);
  manifest.build_id = inventoryId(manifest.files);
  writeJson(path.join(runtime, "manifest.json"), manifest);
  assertInventory(runtime, manifest.files);
  signOne(app, parent);
  if (rehearsal) verifyAppCodeSignature(app, release.publisher.team_id);
  else {
    const temporaryZip = path.join(
      path.dirname(app),
      "animama-notarization.zip",
    );
    try {
      run("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, temporaryZip], {
        capture: true,
      });
      notarize(temporaryZip);
    } finally {
      rmSync(temporaryZip, { force: true });
    }
    run("/usr/bin/xcrun", ["stapler", "staple", app], { capture: true });
    verifySignedApp(app, release.publisher.team_id);
  }
  // Verifying the outer seal is not a substitute for checking every native leaf.
  for (const name of code.native)
    run(
      "/usr/bin/codesign",
      [
        "--verify",
        "--strict",
        "-R",
        `=anchor apple generic and certificate leaf[subject.OU] = "${release.publisher.team_id}"`,
        path.join(app, name),
      ],
      { capture: true },
    );
  assertInventory(runtime, manifest.files);
  writeJson(path.join(desktopRoot, "release/signing-report.json"), {
    schema: "animama-macos-signing/1",
    app_version: release.version,
    release_ready: !rehearsal,
    team_id: release.publisher.team_id,
    distribution: sealedDistribution(runtime),
    stage_build_id: stageBuildId,
    runtime_build_id: manifest.build_id,
    native_files: code.native,
    nested_bundles: code.bundles,
    notarization: rehearsal ? "not-submitted" : "Accepted",
    staple: rehearsal ? "none" : "valid",
    gatekeeper: rehearsal ? "not-assessed" : "accepted",
    entitlements: {
      parent: "entitlements.mac.plist",
      inherited: "entitlements.mac.inherit.plist",
    },
  });
}
