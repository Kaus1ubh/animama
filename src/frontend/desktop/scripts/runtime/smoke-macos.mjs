import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { frontendRoot, parseTarget, readJson, run, sha256 } from "./common.mjs";
import { assertInventory, inventoryId } from "./inventory.mjs";
import { loadReleasePolicy } from "./release-policy.mjs";
import { verifySignedApp } from "./macos-signing.mjs";
import {
  assertFreshProfile,
  runSmokeJourney,
  smokeProviderKey,
} from "./smoke-journey.mjs";

export { temporarySmokeProviderRemoved } from "./smoke-journey.mjs";

/** Exercise the real signed artifact using its canonical profile; never add packaged developer overrides. */
export async function smokeMac(args) {
  parseTarget(["--platform", "darwin", "--arch", "arm64"]);
  if (
    args[0] !== "--artifact" ||
    !args[1] ||
    (args.length !== 2 &&
      !(args.length === 4 && args[2] === "--setup" && args[3] === "name"))
  )
    throw new Error(
      "Expected --artifact <signed.dmg> [--setup name]. Each run requires a fresh macOS account.",
    );
  // Workspace scripts run in the filtered desktop package; documented relative
  // artifacts are rooted at src/frontend, independent of pnpm's child cwd.
  const artifact = path.resolve(frontendRoot, args[1]);
  const stat = lstatSync(artifact);
  if (!stat.isFile() || stat.isSymbolicLink() || !artifact.endsWith(".dmg"))
    throw new Error("Smoke input must be a regular signed DMG");
  const release = loadReleasePolicy();
  const userData = path.join(homedir(), "Library/Application Support/Animama");
  const installed = path.join(homedir(), "Applications/Animama.app");
  assertFreshProfile(
    [
      userData,
      installed,
      path.join(homedir(), "Library/Application Support/Anima"),
      path.join(homedir(), ".config/Anima"),
    ],
    "macOS",
  );
  const provider = smokeProviderKey();
  const report = {
    schema: "animama-macos-smoke/1",
    app_version: release.version,
    dmg_sha256: sha256(artifact),
    setup: "name",
    passed: false,
    checks: {},
    scope:
      "Real packaged app, canonical fresh profile, minimal app PATH. Renderer network events and owned process observations only; manual native/audio/update checks remain separate.",
    manual_checks: "required-separately",
  };
  const work = mkdtempSync(
    path.join(realpathSync(tmpdir()), "animama-artifact-smoke-"),
  );
  const mount = path.join(work, "volume");
  let mounted = false;
  // Do not inherit build tools, developer credentials, NODE_OPTIONS, or desktop overrides.
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  for (const key of [
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TZ",
    "USER",
    "LOGNAME",
  ])
    if (process.env[key]) env[key] = process.env[key];
  await runSmokeJourney({
    report,
    provider,
    platform: {
      userData,
      installed,
      executable: path.join(installed, "Contents/MacOS/Animama"),
      runtime: path.join(installed, "Contents/Resources/runtime"),
      env,
      async install(evidence) {
        run(
          "/usr/bin/codesign",
          [
            "--verify",
            "--strict",
            "-R",
            `=anchor apple generic and certificate leaf[subject.OU] = "${release.publisher.team_id}"`,
            artifact,
          ],
          { capture: true },
        );
        run("/usr/bin/xcrun", ["stapler", "validate", artifact], {
          capture: true,
        });
        mkdirSync(mount);
        run(
          "/usr/bin/hdiutil",
          ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, artifact],
          { capture: true },
        );
        mounted = true;
        verifySignedApp(
          path.join(mount, "Animama.app"),
          release.publisher.team_id,
        );
        const manifest = readJson(
          path.join(
            mount,
            "Animama.app/Contents/Resources/runtime/manifest.json",
          ),
        );
        evidence(
          "runtime_inventory",
          manifest.build_id === inventoryId(manifest.files) &&
            manifest.app_version === release.version,
        );
        assertInventory(
          path.join(mount, "Animama.app/Contents/Resources/runtime"),
          manifest.files,
        );
        // The candidate seals the update policy the release source expects.
        evidence(
          "sealed_update_policy",
          JSON.stringify(
            readJson(
              path.join(
                mount,
                "Animama.app/Contents/Resources/runtime/update-policy.json",
              ),
            ),
          ) === JSON.stringify(release.updatePolicy),
        );
        report.runtime_build_id = manifest.build_id;
        // ditto retains the code signature and stapled ticket; do not touch a pre-existing application.
        mkdirSync(path.dirname(installed), { recursive: true });
        run("/usr/bin/ditto", [path.join(mount, "Animama.app"), installed], {
          capture: true,
        });
        verifySignedApp(installed, release.publisher.team_id);
        run("/usr/bin/hdiutil", ["detach", mount], { capture: true });
        mounted = false;
      },
      ownedChild(child) {
        const binary = realpathSync(child.executable);
        if (
          !binary.startsWith(
            `${realpathSync(installed)}/Contents/Resources/runtime/`,
          )
        )
          return false;
        const actual = run(
          "/bin/ps",
          ["-p", String(child.pid), "-o", "comm="],
          { capture: true },
        ).trim();
        return actual === child.executable;
      },
      cleanup() {
        if (mounted) {
          try {
            run("/usr/bin/hdiutil", ["detach", mount], { capture: true });
            mounted = false;
          } catch {
            return "artifact-unmount";
          }
        }
        rmSync(work, { recursive: true, force: true });
        return null;
      },
    },
  });
}
