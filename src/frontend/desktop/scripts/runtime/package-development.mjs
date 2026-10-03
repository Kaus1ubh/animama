import { existsSync } from "node:fs";
import path from "node:path";
import { build, Platform, Arch } from "electron-builder";
import { desktopRoot, parseTarget, readJson, writeJson } from "./common.mjs";
import { buildWindowsIcon } from "./icon.mjs";
import { assertInventory, componentInventory } from "./inventory.mjs";
import { brandPackagedApp } from "./windows-resources.mjs";

/**
 * Build a local unsigned app for this host's target without mutating the
 * audited native runtime. Production signing has its own reviewed contract.
 *
 * - macOS arm64: an unsigned `.app` directory. Apple Silicon otherwise falls
 *   back to ad-hoc signing even when certificate discovery is disabled,
 *   invalidating the staged per-file hashes.
 * - Windows x64: an unsigned `win-unpacked` directory, or with `--installer`
 *   an unsigned per-user NSIS installer for local installer testing. Neither
 *   is ever a release.
 */
const installer = process.argv.includes("--installer");
// The script names its target; parseTarget refuses a different host.
const target = parseTarget(
  process.argv.slice(2).filter((arg) => arg !== "--installer"),
);
const windows = target.platform === "win32";
if (installer && !windows)
  throw new Error("--installer builds the Windows NSIS installer only");
const extends_ = path.join(desktopRoot, "electron-builder.yml");
const icon = windows ? await buildWindowsIcon() : undefined;
await build({
  projectDir: desktopRoot,
  targets: windows
    ? Platform.WINDOWS.createTarget([installer ? "nsis" : "dir"], Arch.x64)
    : Platform.MAC.createTarget(["dir"], Arch.arm64),
  publish: "never",
  config: windows
    ? {
        extends: extends_,
        forceCodeSigning: false,
        // Sign nothing, so the staged runtime keeps its audited hashes even if
        // a certificate is configured; release signing is a separate contract.
        // electron-builder's own executable editing needs a tool download
        // that requires Developer Mode, so the hook below brands it instead.
        win: { icon, signExts: ["!.exe"], signAndEditExecutable: false },
        // A one-click per-user install folder takes the package name:
        // %LOCALAPPDATA%\Programs\Animama, not ...\animama-desktop.
        extraMetadata: { name: "Animama" },
        afterPack: (context) => {
          brandPackagedApp(context, icon);
        },
      }
    : {
        extends: extends_,
        forceCodeSigning: false,
        mac: { identity: null, notarize: false },
      },
});
// Each default architecture deliberately omits an architecture suffix.
const app = path.join(
  desktopRoot,
  windows ? "release/win-unpacked" : "release/mac/Animama.app",
);
const runtime = path.join(
  app,
  windows ? "resources/runtime" : "Contents/Resources/runtime",
);
const manifest = readJson(path.join(runtime, "manifest.json"));
if (
  manifest.build_id !==
  readJson(path.join(target.runtime, "manifest.json")).build_id
)
  throw new Error(
    "Packaged development runtime differs from the audited stage",
  );
assertInventory(runtime, manifest.files);
// Matches nsis.artifactName in electron-builder.yml.
const installerName = `Animama-${manifest.app_version}-x64-setup.exe`;
if (installer && !existsSync(path.join(desktopRoot, "release", installerName)))
  throw new Error(`electron-builder did not produce release/${installerName}`);
writeJson(path.join(desktopRoot, "release/development-package-report.json"), {
  schema: "animama-development-package/1",
  target: target.target,
  app_version: manifest.app_version,
  runtime_build_id: manifest.build_id,
  app: windows ? "win-unpacked/Animama.exe" : "mac/Animama.app",
  ...(installer ? { installer: installerName } : {}),
  installed_bytes: componentInventory(app).reduce(
    (total, file) => total + file.size_bytes,
    0,
  ),
  runtime_inventory: "exact-audited-stage",
  release_ready: false,
  signing: "unsigned-development-only",
});
console.log(
  `Unsigned development ${installer ? `installer: release/${installerName}` : `app: release/${windows ? "win-unpacked" : "mac/Animama.app"}`}; runtime inventory: OK`,
);
