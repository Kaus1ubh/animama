import path from "node:path";
import { build, Platform, Arch } from "electron-builder";
import { desktopRoot, parseTarget, readJson, writeJson } from "./common.mjs";
import { assertInventory, componentInventory } from "./inventory.mjs";

/** Build a local unsigned app without mutating the audited native runtime.
 * Apple Silicon otherwise falls back to ad-hoc signing even when certificate
 * discovery is disabled, invalidating the staged per-file hashes. Production
 * signing has its own reviewed nested-sign/manifest/outer-seal contract.
 */
const target = parseTarget(["--platform", "darwin", "--arch", "arm64"]);
await build({
  projectDir: desktopRoot,
  targets: Platform.MAC.createTarget(["dir"], Arch.arm64),
  publish: "never",
  config: {
    extends: path.join(desktopRoot, "electron-builder.yml"),
    forceCodeSigning: false,
    mac: { identity: null, notarize: false },
  },
});
// defaultArch=arm64 deliberately omits an architecture suffix for this target.
const app = path.join(desktopRoot, "release/mac/Animama.app");
const runtime = path.join(app, "Contents/Resources/runtime");
const manifest = readJson(path.join(runtime, "manifest.json"));
if (
  manifest.build_id !==
  readJson(path.join(target.runtime, "manifest.json")).build_id
)
  throw new Error(
    "Packaged development runtime differs from the audited stage",
  );
assertInventory(runtime, manifest.files);
writeJson(path.join(desktopRoot, "release/development-package-report.json"), {
  schema: "animama-development-package/1",
  app_version: manifest.app_version,
  runtime_build_id: manifest.build_id,
  app: "mac/Animama.app",
  installed_bytes: componentInventory(app).reduce(
    (total, file) => total + file.size_bytes,
    0,
  ),
  runtime_inventory: "exact-audited-stage",
  release_ready: false,
  signing: "unsigned-development-only",
});
console.log(
  "Unsigned development app: release/mac/Animama.app; runtime inventory: OK",
);
