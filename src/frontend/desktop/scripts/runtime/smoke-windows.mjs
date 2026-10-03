import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { frontendRoot, parseTarget, readJson, run, sha256 } from "./common.mjs";
import { assertInventory, inventoryId } from "./inventory.mjs";
import { loadReleasePolicy } from "./release-policy.mjs";
import {
  assertFreshProfile,
  runSmokeJourney,
  smokeProviderKey,
} from "./smoke-journey.mjs";
import { readSignatures, signatureEntry } from "./windows-signing.mjs";

const systemRoot = () => process.env.SystemRoot || "C:\\Windows";
// Windows path rules, also when these helpers are unit-tested on another host.
const win = path.win32;

/** Lower-cased, so Windows paths compare case-insensitively. */
const folded = (file) => win.resolve(file).toLowerCase();

/**
 * Every running process's image path by PID. CIM reports processes of this
 * account; others' image paths are empty and never match an installed path.
 */
export function processImages() {
  const output = run(
    path.join(
      systemRoot(),
      "System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ExecutablePath)" }',
    ],
    { capture: true },
  );
  return parseProcessImages(output);
}

export function parseProcessImages(output) {
  const images = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const [pid, image] = line.split("\t");
    if (/^\d+$/u.test(pid ?? "") && image) images.set(Number(pid), image);
  }
  return images;
}

/**
 * A recorded child is owned when its guard and its service both run from the
 * installed runtime, and the service is the executable the record names.
 */
export function ownedWindowsChild(child, runtime, images) {
  const inside = (file) =>
    Boolean(file) && folded(file).startsWith(`${folded(runtime)}\\`);
  return (
    inside(child.executable) &&
    folded(images.get(child.servicePid) ?? "") === folded(child.executable) &&
    folded(images.get(child.pid) ?? "") ===
      folded(win.join(runtime, "bin", "animama-process-guard.exe"))
  );
}

/** The canonical per-user locations; a fresh Windows account has none of them. */
export function windowsProfile(env = process.env) {
  const local = env.LOCALAPPDATA;
  const roaming = env.APPDATA;
  if (!local || !roaming || !env.USERPROFILE)
    throw new Error("Run smoke from a normal Windows user session");
  return {
    userData: win.join(local, "Animama"),
    installed: win.join(local, "Programs", "Animama"),
    existing: [
      win.join(local, "Animama"),
      win.join(local, "Programs", "Animama"),
      win.join(roaming, "Animama"),
      win.join(roaming, "Anima"),
    ],
  };
}

/**
 * Electron's minimal environment: the system folders on PATH and the profile
 * locations Windows itself needs. Build tools, developer credentials,
 * NODE_OPTIONS and desktop overrides are never inherited.
 */
export function windowsLaunchEnvironment(source = process.env) {
  const root = source.SystemRoot || "C:\\Windows";
  const env = { PATH: `${root}\\System32;${root}` };
  for (const key of [
    "SystemRoot",
    "SystemDrive",
    "windir",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "USERNAME",
    "USERDOMAIN",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "APPDATA",
    "ProgramData",
  ])
    if (source[key]) env[key] = source[key];
  return env;
}

/**
 * Install the exact signed installer for this user in a fresh Windows
 * account, then run the shared required-name journey through Playwright.
 */
export async function smokeWindows(args) {
  parseTarget(["--platform", "win32", "--arch", "x64"]);
  if (
    args[0] !== "--artifact" ||
    !args[1] ||
    (args.length !== 2 &&
      !(args.length === 4 && args[2] === "--setup" && args[3] === "name"))
  )
    throw new Error(
      "Expected --artifact <Animama-<version>-x64-setup.exe> [--setup name]. Each run requires a fresh Windows account.",
    );
  const artifact = path.resolve(frontendRoot, args[1]);
  const stat = lstatSync(artifact);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !artifact.endsWith("-x64-setup.exe")
  )
    throw new Error("Smoke input must be a regular signed Windows installer");
  const release = loadReleasePolicy({ target: "win32-x64" });
  const installerName = `Animama-${release.version}-x64-setup.exe`;
  if (path.basename(artifact) !== installerName)
    throw new Error(`Smoke input must be ${installerName}`);
  const { userData, installed, existing } = windowsProfile();
  assertFreshProfile(existing, "Windows");
  const provider = smokeProviderKey();
  const runtime = path.join(installed, "resources", "runtime");
  const verifySigned = (directory, name) =>
    signatureEntry(
      name,
      sha256(path.join(directory, name)),
      readSignatures(directory, [name]).get(name),
      release.windowsPublisher,
      true,
    );
  const report = {
    schema: "animama-windows-smoke/1",
    app_version: release.version,
    installer_sha256: sha256(artifact),
    setup: "name",
    passed: false,
    checks: {},
    scope:
      "Real signed installer, per-user install into a fresh account, minimal app PATH. Renderer network events and owned process observations only; manual native/audio/update checks remain separate.",
    manual_checks: "required-separately",
  };
  await runSmokeJourney({
    report,
    provider,
    platform: {
      userData,
      installed,
      executable: path.join(installed, "Animama.exe"),
      env: windowsLaunchEnvironment(),
      async install(evidence) {
        verifySigned(path.dirname(artifact), path.basename(artifact));
        // The one-click installer waits until the per-user install completes.
        run(artifact, ["/S"], { capture: true });
        verifySigned(installed, "Animama.exe");
        const manifest = readJson(path.join(runtime, "manifest.json"));
        evidence(
          "runtime_inventory",
          manifest.build_id === inventoryId(manifest.files) &&
            manifest.app_version === release.version,
        );
        assertInventory(runtime, manifest.files);
        report.runtime_build_id = manifest.build_id;
      },
      ownedChild: (child) =>
        ownedWindowsChild(child, realpathSync(runtime), processImages()),
      noInstalledProcesses() {
        const root = `${folded(realpathSync(installed))}\\`;
        return [...processImages().values()].every(
          (image) => !folded(image).startsWith(root),
        );
      },
    },
  });
}
