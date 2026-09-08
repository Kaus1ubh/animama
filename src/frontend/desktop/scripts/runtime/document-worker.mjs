import { lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  cacheRoot,
  desktopRoot,
  copyTree,
  filesIn,
  normalizeTree,
  parseTarget,
  pythonEnvironment,
  readJson,
  repoRoot,
  run,
  sourceRoot,
  writeJson,
} from "./common.mjs";

import { prepareDocumentLibraries } from "./document-native.mjs";
import { auditMacosMinimum } from "./macos-platform.mjs";

const target = parseTarget();
const source = readJson(path.join(sourceRoot, "source-manifest.json"));
const release = readJson(path.join(sourceRoot, "feature-pack-releases.json"));
const minimumOs = readJson(
  path.join(sourceRoot, "native-components.lock.json"),
).minimum_os;
if (!/^\d+\.\d+(?:\.\d+)?$/u.test(minimumOs))
  throw new Error("Invalid document worker minimum macOS version");
const publisher = release.macos;
const profile = process.env.ANIMAMA_MACOS_NOTARY_PROFILE;
if (
  !/^[A-Z0-9]{10}$/u.test(publisher?.team_id ?? "") ||
  typeof publisher.signing_identity !== "string" ||
  !publisher.signing_identity.startsWith("Developer ID Application:") ||
  !publisher.signing_identity.endsWith(`(${publisher.team_id})`) ||
  typeof publisher.designated_requirement !== "string" ||
  !publisher.designated_requirement ||
  !profile
) {
  throw new Error(
    "Document worker build requires the reviewed macOS Team ID, Developer ID identity and designated requirement in runtime/feature-pack-releases.json, plus ANIMAMA_MACOS_NOTARY_PROFILE. Unsigned workers are never enabled.",
  );
}
const work = path.join(cacheRoot, "document-worker", target.target);
const environment = {
  ...pythonEnvironment(),
  UV_PROJECT_ENVIRONMENT: path.join(
    cacheRoot,
    "worker-build-venv",
    target.target,
  ),
  ANIMAMA_WORKER_BUILD_RESOURCES: path.join(work, "resources"),
};
const python = path.join(environment.UV_PROJECT_ENVIRONMENT, "bin/python");
const root = path.join(work, "signed-input");
const bundle = path.join(root, "Animama Document Worker.app");
const executableRoot = path.join(bundle, "Contents/Resources/document-worker");
const launcher = path.join(bundle, "Contents/MacOS/animama-document-worker");
mkdirSync(work, { recursive: true });
run(
  "uv",
  [
    "sync",
    "--python",
    source.python,
    "--frozen",
    "--no-default-groups",
    "--group",
    "desktop-build",
    "--extra",
    "file-worker",
  ],
  { env: environment },
);
run(
  python,
  [
    path.join(
      repoRoot,
      "src/backend/packaging/desktop/document_worker_resources.py",
    ),
    environment.ANIMAMA_WORKER_BUILD_RESOURCES,
  ],
  { env: environment },
);
run(
  python,
  [
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--distpath",
    path.join(work, "frozen"),
    "--workpath",
    path.join(work, "pyinstaller"),
    path.join(
      repoRoot,
      "src/backend/packaging/desktop/animama-document-worker.spec",
    ),
  ],
  { env: environment },
);
// Only this derived build directory is replaced; installed packs live elsewhere.
rmSync(root, { recursive: true, force: true });
copyTree(path.join(work, "frozen/animama-document-worker"), executableRoot);
mkdirSync(path.dirname(launcher), { recursive: true });
run("/usr/bin/clang", [
  "-arch",
  "arm64",
  `-mmacosx-version-min=${minimumOs}`,
  "-Wall",
  "-Wextra",
  "-Werror",
  "-Os",
  path.join(sourceRoot, "document-worker-launcher.c"),
  "-o",
  launcher,
]);
const version = release.packs["document-processing"].version;
if (!/^\d+\.\d+\.\d+$/u.test(version))
  throw new Error("Invalid worker version");
writeFileSync(
  path.join(bundle, "Contents/Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.animama.document-worker</string>
<key>CFBundleName</key><string>Animama Document Worker</string>
<key>CFBundleExecutable</key><string>animama-document-worker</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>${minimumOs}</string>
<key>LSBackgroundOnly</key><true/>
</dict></plist>\n`,
);
const nativeInventory = prepareDocumentLibraries({
  frozenRoot: path.join(work, "frozen/animama-document-worker"),
  executableRoot,
});
normalizeTree(root);
const nativeFiles = [
  ...nativeInventory.files.map(({ path: name }) =>
    path.relative(root, path.join(executableRoot, name)),
  ),
  path.relative(root, launcher),
];
const nativePlatforms = auditMacosMinimum(root, nativeFiles, minimumOs);
writeJson(path.join(bundle, "Contents/Resources/NATIVE_LIBRARIES.json"), {
  schema: "animama-document-native/1",
  payload_root: "Contents/Resources/document-worker",
  ...nativeInventory,
  minimum_macos: minimumOs,
  platforms: nativePlatforms,
});
const installed = filesIn(root).reduce(
  (sum, name) => sum + lstatSync(path.join(root, name)).size,
  0,
);
const ceiling = readJson(path.join(sourceRoot, "size-budgets.json")).packs[
  "document-processing"
].installed_bytes;
if (installed > ceiling)
  throw new Error(
    `Document worker exceeds its reviewed ${ceiling}-byte ceiling (${installed}); do not silently increase it.`,
  );
console.log(
  `Document worker native audit: ${nativeFiles.length} binaries, ${nativeInventory.relocations.length} relocations, ${installed} installed bytes (ceiling ${ceiling}). Signing with the configured Developer ID.`,
);
// Sign leaves first. No ad-hoc identity or skip-verification switch exists.
const entitlements = path.join(
  sourceRoot,
  "document-worker.entitlements.plist",
);
for (const name of nativeFiles.sort((a, b) => b.length - a.length)) {
  // Signing the app signs its CFBundleExecutable. Do that only after all
  // payload code is signed; Resources natives are not traversed by --deep.
  if (path.join(root, name) === launcher) continue;
  run(
    "/usr/bin/codesign",
    [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--sign",
      publisher.signing_identity,
      "--entitlements",
      entitlements,
      path.join(root, name),
    ],
    { capture: true },
  );
  run(
    "/usr/bin/codesign",
    [
      "--verify",
      "--strict",
      "-R",
      `=anchor apple generic and certificate leaf[subject.OU] = "${publisher.team_id}"`,
      path.join(root, name),
    ],
    { capture: true },
  );
}
run(
  "/usr/bin/codesign",
  [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    publisher.signing_identity,
    "--entitlements",
    entitlements,
    bundle,
  ],
  { capture: true },
);
const requirement = `anchor apple generic and certificate leaf[subject.OU] = "${publisher.team_id}" and (${publisher.designated_requirement})`;
run(
  "/usr/bin/codesign",
  ["--verify", "--deep", "--strict", "-R", `=${requirement}`, bundle],
  { capture: true },
);
const zip = path.join(work, "document-worker-notarization.zip");
rmSync(zip, { force: true });
run("/usr/bin/ditto", ["-c", "-k", "--keepParent", bundle, zip]);
console.log(
  "Document worker signed. Submitting to Apple; the private response is saved in the build cache.",
);
const notarization = JSON.parse(
  run(
    "/usr/bin/xcrun",
    [
      "notarytool",
      "submit",
      zip,
      "--keychain-profile",
      profile,
      "--wait",
      "--timeout",
      "20m",
      "--output-format",
      "json",
    ],
    { capture: true, logFile: path.join(work, "notarization-response.log") },
  ),
);
if (notarization.status !== "Accepted")
  throw new Error(
    "Document worker notarization was not accepted; inspect the cached response before retrying.",
  );
console.log(
  "Document worker notarization accepted. Verifying the stapled ticket and frozen resource probe.",
);
run("/usr/bin/xcrun", ["stapler", "staple", bundle], { capture: true });
run("/usr/bin/xcrun", ["stapler", "validate", bundle], { capture: true });
run("/usr/sbin/spctl", ["--assess", "--type", "execute", bundle], {
  capture: true,
});
// Execute only after OS verification, with all model downloads disabled.
const audit = run(launcher, ["--audit-resources"], {
  cwd: work,
  env: { ...environment, PYINSTALLER_RESET_ENVIRONMENT: "1" },
  capture: true,
});
writeJson(path.join(work, "audit.json"), JSON.parse(audit));
console.log(
  "Signed document worker staged for exact-inventory review. It is not published or enabled in the core catalog yet.",
);
run(process.execPath, [
  path.join(desktopRoot, "scripts/runtime/worker-input.mjs"),
  "export",
]);
