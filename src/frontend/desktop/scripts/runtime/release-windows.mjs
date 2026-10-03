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
import { buildWindowsIcon } from "./icon.mjs";
import { assertInventory, inventoryId } from "./inventory.mjs";
import {
  builderPublishConfig,
  loadReleasePolicy,
  sealedDistribution,
  verifyRedistributionReview,
} from "./release-policy.mjs";
import {
  releaseName,
  releaseSbom,
  releaseSizes,
  updateFeed,
  writeArtifactIndex,
} from "./release-artifacts.mjs";
import { stageReleaseModels } from "./release-models.mjs";
import { signBuilderFile, signWindowsApp } from "./sign-windows.mjs";
import { brandPackagedApp } from "./windows-resources.mjs";
import {
  portableExecutables,
  readSignatures,
  signatureEntry,
  signingTools,
  validateSigningReport,
} from "./windows-signing.mjs";

const TARGET = "win32-x64";

/** No arguments, or `--signing-rehearsal`: sign and measure a candidate that can never be released. */
export function parseWindowsReleaseArgs(args = []) {
  if (!args.length) return { rehearsal: false };
  if (args.length === 1 && args[0] === "--signing-rehearsal")
    return { rehearsal: true };
  throw new Error("Expected no arguments or --signing-rehearsal");
}

/**
 * electron-builder options for the signed per-user installer. Its own Windows
 * signing and executable editing stay off: they fetch an unpinned Azure module
 * or the legacy winCodeSign archive (plan items 5 and 26). `afterPack` brands
 * and signs the app; the `sign` hook signs the uninstaller and installer.
 */
export function windowsBuilderOptions({ icon, release, afterPack, sign }) {
  return {
    projectDir: desktopRoot,
    targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
    publish: "never",
    config: {
      extends: path.join(desktopRoot, "electron-builder.yml"),
      forceCodeSigning: true,
      publish: builderPublishConfig(release.distribution),
      // A one-click per-user install folder takes the package name.
      extraMetadata: { name: "Animama" },
      win: {
        icon,
        signAndEditExecutable: false,
        signtoolOptions: { signingHashAlgorithms: ["sha256"], sign },
      },
      afterPack,
    },
  };
}

/** Signed candidates stay local; publication is a separate, explicitly approved step. */
export async function releaseWindows(args = []) {
  const { rehearsal } = parseWindowsReleaseArgs(args);
  const target = parseTarget(["--platform", "win32", "--arch", "x64"]);
  const release = loadReleasePolicy({
    target: TARGET,
    requireReview: !rehearsal,
  });
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
  if (!rehearsal) verifyRedistributionReview(target.runtime, release);
  const catalog = readJson(path.join(target.runtime, "pack-catalog.json"));
  // Feature packs are signed and published for macOS only so far.
  if (release.activePackIds.length || catalog.entries.length)
    throw new Error(
      "Windows feature-pack releases are not implemented; keep every pack deferred",
    );
  if (
    JSON.stringify(
      readJson(path.join(target.runtime, "update-policy.json")),
    ) !== JSON.stringify(release.updatePolicy)
  )
    throw new Error(
      "The release policy or ANIMAMA_RELEASE_DISTRIBUTION differs from the one used for staging; stage and audit again with the same selection",
    );
  run(process.execPath, [
    path.join(desktopRoot, "scripts/runtime/audit.mjs"),
    "--platform",
    "win32",
    "--arch",
    "x64",
  ]);
  const tools = signingTools();
  const icon = await buildWindowsIcon();
  const directory = path.join(desktopRoot, "release");
  const installerName = `Animama-${release.version}-x64-setup.exe`;
  const installer = path.join(directory, installerName);
  // These paths contain derived artifacts only, never the user-data directory.
  for (const name of [
    "publish",
    "win-unpacked",
    "signing-report.json",
    installerName,
    `${installerName}.blockmap`,
  ])
    rmSync(path.join(directory, name), { recursive: true, force: true });

  let signed = null;
  const builderFiles = new Map();
  await build(
    windowsBuilderOptions({
      icon,
      release,
      afterPack: (context) => {
        brandPackagedApp(context, icon);
        signed = signWindowsApp(context.appOutDir, {
          release,
          tools,
          rehearsal,
        });
      },
      sign: ({ path: file }) => {
        const entry = signBuilderFile(file, { release, tools });
        builderFiles.set(entry.path, entry);
      },
    }),
  );

  const app = path.join(directory, "win-unpacked");
  const runtime = path.join(app, "resources/runtime");
  const manifest = readJson(path.join(runtime, "manifest.json"));
  if (
    manifest.build_id !== inventoryId(manifest.files) ||
    manifest.build_id !== signed?.runtime_build_id ||
    manifest.app_version !== release.version
  )
    throw new Error("Signed runtime identity mismatch");
  assertInventory(runtime, manifest.files);
  // Nothing may change a signed file between signing and the installer.
  const files = portableExecutables(app);
  const final = readSignatures(app, files);
  if (
    files.join("\n") !== signed.files.map((entry) => entry.path).join("\n") ||
    signed.files.some(
      (entry) =>
        signatureEntry(
          entry.path,
          entry.sha256,
          final.get(entry.path),
          release.windowsPublisher,
          entry.signer === "animama",
        ).sha256 !== entry.sha256,
    )
  )
    throw new Error("The packaged app changed after signing");
  const uninstaller = builderFiles.get(
    `${path.basename(installerName, ".exe")}__uninstaller.exe`,
  );
  const installerEntry = signatureEntry(
    installerName,
    sha256(installer),
    readSignatures(directory, [installerName]).get(installerName),
    release.windowsPublisher,
    true,
  );
  if (installerEntry.sha256 !== builderFiles.get(installerName)?.sha256)
    throw new Error("The installer changed after it was signed");
  const report = validateSigningReport(
    {
      schema: "animama-windows-signing/1",
      app_version: release.version,
      release_ready: !rehearsal,
      distribution: sealedDistribution(runtime),
      certificate_subject: release.windowsPublisher.certificate_subject,
      identity_validation_eku: release.windowsPublisher.identity_validation_eku,
      tools: tools.versions,
      stage_build_id: signed.stage_build_id,
      runtime_build_id: signed.runtime_build_id,
      signatures_used:
        signed.files.filter((entry) => entry.signer === "animama").length + 2,
      files: signed.files,
      installer: installerEntry,
      uninstaller: uninstaller ? { ...uninstaller, path: "uninstaller" } : null,
    },
    release.windowsPublisher,
  );
  writeJson(path.join(directory, "signing-report.json"), report);
  const sizes = releaseSizes(app, directory, manifest, catalog, TARGET);
  if (rehearsal) {
    writeJson(
      path.join(directory, releaseName(TARGET, "size-report.json")),
      sizes,
    );
    console.log(
      `Signing rehearsal complete: ${report.signatures_used} signatures, every PE file valid. Not a release candidate: no redistribution receipt is embedded and no publish folder was written.`,
    );
    return;
  }

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
  copy(installer, installerName);
  // JSON is a YAML subset supported by electron-updater's js-yaml parser.
  json(
    "latest.yml",
    await updateFeed(
      directory,
      manifest,
      sizes.installed_bytes,
      catalog,
      release.updatePolicy.distribution,
      TARGET,
    ),
  );
  json(releaseName(TARGET, "size-report.json"), sizes);
  copy(
    path.join(runtime, "manifest.json"),
    releaseName(TARGET, "runtime-manifest.json"),
  );
  copy(
    path.join(runtime, "pack-catalog.json"),
    releaseName(TARGET, "pack-catalog.json"),
  );
  copy(
    path.join(directory, "signing-report.json"),
    releaseName(TARGET, "signing-report.json"),
  );
  for (const [name, published] of [
    ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
    ["REDISTRIBUTION_REVIEW.json", "REDISTRIBUTION_REVIEW.json"],
    ["inventory.json", "redistribution-inventory.json"],
  ])
    copy(path.join(runtime, "licenses", name), releaseName(TARGET, published));
  json(
    releaseName(TARGET, "sbom.cdx.json"),
    releaseSbom(
      manifest,
      readJson(path.join(runtime, "licenses/inventory.json")),
    ),
  );
  copy(
    path.join(target.output, "feature-packs/pack-build-report.json"),
    releaseName(TARGET, "pack-build-report.json"),
  );
  // Model sets are the same bytes for every target and keep their shared names.
  names.push(...stageReleaseModels({ runtime, directory: publish }));
  writeArtifactIndex(
    publish,
    release.version,
    names,
    { runtime_build_id: manifest.build_id, smoke_verified: false },
    TARGET,
  );
  writeFileSync(
    path.join(directory, "RELEASE-NEXT-STEPS.txt"),
    "Local signed Windows candidate only. Repeat the installer journey with this exact installer in a separate Windows account and record SmartScreen's behavior on download. Updates, smoke and publication tooling for Windows arrive in a later phase; nothing was uploaded by this build. Each build used Artifact Signing signatures; rebuild only for an intentional new candidate.\n",
  );
  console.log(
    `Signed Windows candidate built and size-checked (${report.signatures_used} signatures). Publication remains gated on installer acceptance and later phases.`,
  );
}
