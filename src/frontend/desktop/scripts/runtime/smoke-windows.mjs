import { execFileSync } from "node:child_process";
import { cpSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { frontendRoot, parseTarget, readJson, sha256 } from "./common.mjs";
import { smokeCopyFuseWire, writeFuseWire } from "./fuses.mjs";
import { assertInventory, inventoryId } from "./inventory.mjs";
import {
  MAX_WINDOWS_DATA_ROOT,
  smokeCopyDirectory,
} from "./smoke-hardening.mjs";
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

/** Run a helper with the minimal launch environment, never the smoke key. */
function runMinimal(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: windowsLaunchEnvironment(),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Every running process's image path by PID. CIM reports processes of this
 * account; others' image paths are empty and never match an installed path.
 */
export function processImages() {
  const output = runMinimal(
    path.join(
      systemRoot(),
      "System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      // UTF-8, or a non-ASCII profile path arrives in the console code page.
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ExecutablePath)" }',
    ],
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

/**
 * Fail before anything is installed when the journey copy's throwaway profile
 * (`<%LOCALAPPDATA%>\am-smoke-XXXXXX\p`) would not fit the packaged app's
 * data-root budget: profile folder names of at most 29 characters fit.
 */
export function assertWindowsCopyFits(
  localAppData,
  resolve = realpathSync.native,
) {
  if (!localAppData)
    throw new Error("Run smoke from a normal Windows user session");
  const base = resolve(localAppData);
  // mkdtemp adds six characters to the prefix.
  const length = win.join(base, "am-smoke-XXXXXX", "p").length;
  if (length > MAX_WINDOWS_DATA_ROOT)
    throw new Error(
      `The smoke profile path would be ${length} characters; the app accepts at most ${MAX_WINDOWS_DATA_ROOT}. Use a test account with a shorter profile folder name.`,
    );
  return base;
}

/**
 * A short private folder under the long-form `%LOCALAPPDATA%` for the journey
 * copy (`a`) and its throwaway profile (`p`). The profile fits the packaged
 * app's data-root budget, and the copy's runtime paths are at most one
 * character longer than the installed ones.
 */
export function windowsCopyLocation(
  localAppData,
  { make = smokeCopyDirectory, resolve = realpathSync.native } = {},
) {
  const directory = make(
    assertWindowsCopyFits(localAppData, resolve),
    "am-smoke-",
  );
  return { directory, profile: win.join(directory, "p") };
}

/** Whether no process of this account runs an executable inside `root`. */
function noProcessesUnder(root) {
  const prefix = `${folded(realpathSync(root))}\\`;
  return [...processImages().values()].every(
    (image) => !folded(image).startsWith(prefix),
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
  // Before the installer runs, so a refusal leaves the account fresh.
  assertWindowsCopyFits(process.env.LOCALAPPDATA);
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
      "Exact signed installer, per-user install into a fresh account: fuse wire, publisher signature, sealed update policy and refused debugging switches. Journey: a smoke-made copy with Node's inspect switches on, a throwaway profile and a minimal app PATH. Renderer network events and owned process observations only; manual native/audio/update checks remain separate.",
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
      fuseApp: path.join(installed, "Animama.exe"),
      runtime,
      updatePolicy: release.updatePolicy,
      noInstalledProcesses: () => noProcessesUnder(installed),
      async install(evidence) {
        verifySigned(path.dirname(artifact), path.basename(artifact));
        // The one-click installer waits until the per-user install completes.
        runMinimal(artifact, ["/S"]);
        // The publisher requirement the installed app's updater checks.
        verifySigned(installed, "Animama.exe");
        evidence("publisher_signature", true);
        const manifest = readJson(path.join(runtime, "manifest.json"));
        evidence(
          "runtime_inventory",
          manifest.build_id === inventoryId(manifest.files) &&
            manifest.app_version === release.version,
        );
        assertInventory(runtime, manifest.files);
        report.runtime_build_id = manifest.build_id;
      },
      copyLocation: () => windowsCopyLocation(process.env.LOCALAPPDATA),
      copy(directory) {
        const app = win.join(directory, "a");
        cpSync(installed, app, { recursive: true });
        // The changed executable no longer carries the publisher signature,
        // so its updater refuses to update.
        writeFuseWire(win.join(app, "Animama.exe"), smokeCopyFuseWire());
        const copyRuntime = win.join(app, "resources", "runtime");
        return {
          installed: app,
          executable: win.join(app, "Animama.exe"),
          fuseApp: win.join(app, "Animama.exe"),
          ownedChild: (child) =>
            ownedWindowsChild(
              child,
              realpathSync(copyRuntime),
              processImages(),
            ),
          noInstalledProcesses: () => noProcessesUnder(app),
        };
      },
    },
  });
}
