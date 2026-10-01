import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { build, Platform, Arch } from "electron-builder";
import {
  desktopRoot,
  parseTarget,
  readJson,
  run,
  sha256,
  writeJson,
} from "./common.mjs";
import { assertInventory, inventoryId } from "./inventory.mjs";
import { componentInventory } from "./inventory.mjs";
import {
  loadReleasePolicy,
  releaseTagBase,
  sealedDistribution,
  verifyRedistributionReview,
} from "./release-policy.mjs";
import {
  assertNotarizationSubmissionId,
  nestedCode,
  notarize,
  verifyAppCodeSignature,
  verifySignedApp,
  waitForNotarization,
} from "./macos-signing.mjs";
import { buildIcon } from "./icon.mjs";
import {
  releaseSbom,
  releaseSizes,
  updateFeed,
  writeArtifactIndex,
} from "./release-artifacts.mjs";
import { stageReleaseModels } from "./release-models.mjs";

/** Parse only the exact recovery operation supported by the signed-app boundary. */
export function parseMacReleaseArgs(args = []) {
  if (!args.length) return { submissionId: null };
  if (args.length === 2 && args[0] === "--resume-app-notarization")
    return { submissionId: assertNotarizationSubmissionId(args[1]) };
  throw new Error(
    "Expected no arguments or --resume-app-notarization <submission-id>",
  );
}

/** Keep Electron Builder's prepackaged resume path separate from its signing hook. */
export function macBuilderOptions({ app, icon, release }) {
  const builderIdentity = release.publisher.signing_identity.replace(
    /^Developer ID Application:\s*/u,
    "",
  );
  return {
    ...(app ? { prepackaged: app } : {}),
    projectDir: desktopRoot,
    targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.arm64),
    publish: "never",
    config: {
      extends: path.join(desktopRoot, "electron-builder.yml"),
      forceCodeSigning: true,
      // Writes the app-update.yml electron-builder embeds; the updater itself
      // takes its transport from the staged update policy.
      publish: [
        release.distribution.name === "r2"
          ? {
              provider: "generic",
              url: release.distribution.base_url,
              channel: "latest",
            }
          : {
              provider: "github",
              owner: release.distribution.owner,
              repo: release.distribution.repo,
              private: false,
              releaseType: "release",
            },
      ],
      mac: {
        icon,
        minimumSystemVersion: "15.0",
        identity: builderIdentity,
        hardenedRuntime: true,
        notarize: false,
        ...(!app
          ? { sign: path.join(desktopRoot, "scripts/runtime/sign-macos.mjs") }
          : {}),
      },
      dmg: {
        title: `Animama ${release.version}`,
        icon,
        backgroundColor: "#191720",
        window: { width: 600, height: 400 },
        contents: [
          { x: 160, y: 190, type: "file" },
          { x: 440, y: 190, type: "link", path: "/Applications" },
        ],
      },
    },
  };
}

/** Verify every native leaf and recreate the report lost when the original wait timed out. */
function finishResumedApp(app, target, release, submissionId) {
  const runtime = path.join(app, "Contents/Resources/runtime");
  const manifest = readJson(path.join(runtime, "manifest.json"));
  if (
    manifest.build_id !== inventoryId(manifest.files) ||
    manifest.app_version !== release.version
  )
    throw new Error("Preserved signed runtime identity mismatch");
  assertInventory(runtime, manifest.files);
  verifyRedistributionReview(runtime, release);
  verifyAppCodeSignature(app, release.publisher.team_id);
  const code = nestedCode(app, componentInventory(app));
  if (!code.native.length)
    throw new Error("No native code found in the preserved release app");
  waitForNotarization(submissionId);
  run("/usr/bin/xcrun", ["stapler", "staple", app], { capture: true });
  verifySignedApp(app, release.publisher.team_id);
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
  writeJson(path.join(desktopRoot, "release/signing-report.json"), {
    schema: "animama-macos-signing/1",
    app_version: release.version,
    team_id: release.publisher.team_id,
    distribution: sealedDistribution(runtime),
    stage_build_id: readJson(path.join(target.runtime, "manifest.json"))
      .build_id,
    runtime_build_id: manifest.build_id,
    native_files: code.native,
    nested_bundles: code.bundles,
    notarization: "Accepted",
    notarization_submission_id: submissionId,
    staple: "valid",
    gatekeeper: "accepted",
    entitlements: {
      parent: "entitlements.mac.plist",
      inherited: "entitlements.mac.inherit.plist",
    },
  });
}

/** Signed candidates stay local; only the separate publisher requires a public repository. */
export async function releaseMac(args = []) {
  const { submissionId } = parseMacReleaseArgs(args);
  const target = parseTarget(["--platform", "darwin", "--arch", "arm64"]);
  const release = loadReleasePolicy();
  if (!process.env.ANIMAMA_MACOS_NOTARY_PROFILE)
    throw new Error("A configured notarization Keychain profile is required");
  if (
    existsSync(path.join(target.output, "stage-failure.json")) ||
    !existsSync(path.join(target.output, "audit-report.json"))
  )
    throw new Error(
      "A complete, current native runtime stage and audit are required; no wrapper fallback is allowed",
    );
  const disk = statfsSync(desktopRoot, { bigint: true });
  if (disk.bavail * disk.bsize < 8n * 1024n ** 3n)
    throw new Error(
      "Release packaging requires at least 8 GiB of free build disk space",
    );
  verifyRedistributionReview(target.runtime, release);
  const catalog = readJson(path.join(target.runtime, "pack-catalog.json"));
  if (
    catalog.entries
      .map((entry) => entry.id)
      .sort()
      .join(",") !== release.activePackIds.join(",")
  )
    throw new Error(
      "Release acceptance requires exactly the active reviewed feature-pack artifacts; deferred packs must be absent",
    );
  if (
    release.activePackIds.includes("document-processing") &&
    catalog.entries.find((entry) => entry.id === "document-processing")?.signing
      ?.publisher !== release.publisher.team_id
  )
    throw new Error(
      "Core and document helper must use the same reviewed Apple Team ID",
    );
  if (
    JSON.stringify(
      readJson(path.join(target.runtime, "update-policy.json")),
    ) !== JSON.stringify(release.updatePolicy)
  )
    throw new Error(
      "The release policy or ANIMAMA_RELEASE_DISTRIBUTION differs from the one used for staging; stage and audit again with the same selection",
    );
  // Repository coordinates pin future pack/update URLs, not present visibility.
  // Do not query GitHub or request a token merely to build a local candidate.
  run(process.execPath, [
    path.join(desktopRoot, "scripts/runtime/audit.mjs"),
    "--platform",
    "darwin",
    "--arch",
    "arm64",
  ]);
  const icon = await buildIcon();
  const directory = path.join(desktopRoot, "release");
  const app = path.join(directory, "mac/Animama.app");
  if (submissionId) {
    if (!existsSync(app))
      throw new Error("The preserved signed Animama.app is missing");
    finishResumedApp(app, target, release, submissionId);
  }
  // These paths contain derived artifacts only, never the canonical user-data directory.
  for (const name of [
    "publish",
    ...(!submissionId ? ["mac", "signing-report.json"] : []),
    `Animama-${release.version}-arm64.dmg`,
    `Animama-${release.version}-arm64.zip`,
  ])
    rmSync(path.join(directory, name), { recursive: true, force: true });
  await build(
    macBuilderOptions({ app: submissionId ? app : null, icon, release }),
  );
  const runtime = path.join(app, "Contents/Resources/runtime");
  const manifest = readJson(path.join(runtime, "manifest.json"));
  if (
    manifest.build_id !== inventoryId(manifest.files) ||
    manifest.app_version !== release.version
  )
    throw new Error("Signed runtime identity mismatch");
  assertInventory(runtime, manifest.files);
  verifySignedApp(app, release.publisher.team_id);
  const dmg = path.join(directory, `Animama-${release.version}-arm64.dmg`);
  run(
    "/usr/bin/codesign",
    [
      "--force",
      "--timestamp",
      "--sign",
      release.publisher.signing_identity,
      dmg,
    ],
    { capture: true },
  );
  notarize(dmg);
  notarize(path.join(directory, `Animama-${release.version}-arm64.zip`));
  run("/usr/bin/xcrun", ["stapler", "staple", dmg], { capture: true });
  run("/usr/bin/xcrun", ["stapler", "validate", dmg], { capture: true });
  run(
    "/usr/sbin/spctl",
    [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      dmg,
    ],
    { capture: true },
  );
  const sizes = releaseSizes(app, directory, manifest, catalog);
  const publish = path.join(directory, "publish");
  mkdirSync(publish, { recursive: true });
  const names = [];
  const copy = (source, name) => {
    copyFileSync(source, path.join(publish, name));
    names.push(name);
  };
  const json = (name, data) => {
    writeJson(path.join(publish, name), data);
    names.push(name);
  };
  for (const extension of ["dmg", "zip"])
    copy(
      path.join(directory, `Animama-${release.version}-arm64.${extension}`),
      `Animama-${release.version}-arm64.${extension}`,
    );
  // JSON is a YAML subset supported by electron-updater's js-yaml parser.
  json(
    "latest-mac.yml",
    await updateFeed(
      directory,
      manifest,
      sizes.installed_bytes,
      catalog,
      release.updatePolicy.distribution,
    ),
  );
  json("size-report.json", sizes);
  copy(path.join(runtime, "manifest.json"), "runtime-manifest.json");
  copy(path.join(runtime, "pack-catalog.json"), "pack-catalog.json");
  copy(path.join(directory, "signing-report.json"), "signing-report.json");
  for (const name of [
    "THIRD_PARTY_NOTICES.txt",
    "REDISTRIBUTION_REVIEW.json",
    "inventory.json",
  ])
    copy(
      path.join(runtime, "licenses", name),
      name === "inventory.json" ? "redistribution-inventory.json" : name,
    );
  json(
    "sbom.cdx.json",
    releaseSbom(
      manifest,
      readJson(path.join(runtime, "licenses/inventory.json")),
    ),
  );
  for (const pack of catalog.entries) {
    const name = path.posix.basename(new URL(pack.url).pathname);
    const file = path.join(target.output, "feature-packs", name);
    const tag =
      release.packReleases[pack.id]?.release_tag ?? `v${release.version}`;
    if (
      sha256(file) !== pack.archive_sha256 ||
      !pack.url.startsWith(`${releaseTagBase(release.distribution, tag)}/`)
    )
      throw new Error(
        "Feature pack does not match the signed app's release catalog",
      );
    copy(file, name);
  }
  copy(
    path.join(target.output, "feature-packs/pack-build-report.json"),
    "pack-build-report.json",
  );
  names.push(...stageReleaseModels({ runtime, directory: publish }));
  writeArtifactIndex(publish, release.version, names, {
    runtime_build_id: manifest.build_id,
    smoke_verified: false,
  });
  writeFileSync(
    path.join(directory, "RELEASE-NEXT-STEPS.txt"),
    "Local signed candidate only; the release repository may remain private. Follow docs/frontend/desktop/release-process.md for fresh-account required-name smoke and native acceptance. Pack and update URLs work only once the selected distribution serves them publicly; never embed a token or bypass runtime checks. Public preview/stable publication requires separate explicit approval. Nothing was uploaded by this build; notarization submits binaries to Apple.\n",
  );
  console.log(
    "Signed candidate built and size-checked. Publication remains gated on clean-machine smoke and explicit manual acceptance.",
  );
}
