import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { sourceRoot, readJson } from "./common.mjs";

// This helper is deliberately unavailable on a developer workstation. It only
// mutates an ephemeral Actions runner's Keychain and restores its previous list.
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.platform !== "darwin" ||
  !process.env.RUNNER_TEMP
)
  throw new Error(
    "CI Keychain setup is restricted to ephemeral macOS Actions runners",
  );
const root = path.join(process.env.RUNNER_TEMP, "animama-signing");
const stateFile = path.join(root, "state.json");
const keychain = path.join(root, "release.keychain-db");
const command = (binary, args) => {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });
  // Security/notary output and arguments may contain credentials. Never print them.
  if (result.error || result.status !== 0)
    throw new Error(
      "CI Keychain operation failed; credentials and command output were withheld",
    );
  return result.stdout.trim();
};
const security = (...args) => command("/usr/bin/security", args);
const cleanup = () => {
  if (!existsSync(stateFile)) return;
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  security("default-keychain", "-d", "user", "-s", state.defaultKeychain);
  security("list-keychains", "-d", "user", "-s", ...state.search);
  if (existsSync(keychain)) security("delete-keychain", keychain);
  rmSync(root, { recursive: true, force: true });
};
if (process.argv[2] === "cleanup") cleanup();
else if (process.argv[2] === "setup") {
  if (existsSync(root))
    throw new Error(
      "CI signing state already exists; run cleanup before retrying",
    );
  const required = [
    "ANIMAMA_MACOS_CERTIFICATE_BASE64",
    "ANIMAMA_MACOS_CERTIFICATE_PASSWORD",
    "ANIMAMA_APPLE_ID",
    "ANIMAMA_APPLE_APP_PASSWORD",
    "ANIMAMA_MACOS_NOTARY_PROFILE",
  ];
  if (required.some((key) => !process.env[key]))
    throw new Error("Missing protected signing/notarization CI secrets");
  const publisher = readJson(
    path.join(sourceRoot, "feature-pack-releases.json"),
  ).macos;
  if (!/^[A-Z0-9]{10}$/u.test(publisher.team_id ?? ""))
    throw new Error("Missing reviewed Apple Team ID");
  mkdirSync(root, { mode: 0o700 });
  const state = {
    defaultKeychain: security("default-keychain", "-d", "user").replaceAll(
      '"',
      "",
    ),
    search: [
      ...security("list-keychains", "-d", "user").matchAll(/"([^"]+)"/gu),
    ].map((match) => match[1]),
  };
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  const certificate = path.join(root, "developer-id.p12");
  try {
    const password = randomBytes(32).toString("hex");
    security("create-keychain", "-p", password, keychain);
    security("set-keychain-settings", "-lut", "21600", keychain);
    security("unlock-keychain", "-p", password, keychain);
    writeFileSync(
      certificate,
      Buffer.from(process.env.ANIMAMA_MACOS_CERTIFICATE_BASE64, "base64"),
      { mode: 0o600 },
    );
    security(
      "import",
      certificate,
      "-k",
      keychain,
      "-P",
      process.env.ANIMAMA_MACOS_CERTIFICATE_PASSWORD,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    );
    security(
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      password,
      keychain,
    );
    security("list-keychains", "-d", "user", "-s", keychain, ...state.search);
    security("default-keychain", "-d", "user", "-s", keychain);
    command("/usr/bin/xcrun", [
      "notarytool",
      "store-credentials",
      process.env.ANIMAMA_MACOS_NOTARY_PROFILE,
      "--keychain",
      keychain,
      "--apple-id",
      process.env.ANIMAMA_APPLE_ID,
      "--team-id",
      publisher.team_id,
      "--password",
      process.env.ANIMAMA_APPLE_APP_PASSWORD,
    ]);
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    rmSync(certificate, { force: true });
  }
} else throw new Error("Expected setup or cleanup");
