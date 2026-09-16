import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { release, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This explicit native check must fail on unsupported hosts, rather than report
// a skipped native test as acceptance. Ordinary wrapper tests remain portable.
if (
  process.platform !== "darwin" ||
  process.arch !== "arm64" ||
  Number.parseInt(release(), 10) < 24
) {
  throw new Error("Native input tests require macOS 15+ on Apple silicon.");
}

const source = fileURLToPath(
  new URL(
    "../../native/global-input-hook/tests/hook_mac_test.cc",
    import.meta.url,
  ),
);
const directory = mkdtempSync(
  path.join(tmpdir(), "animama-native-input-test-"),
);
const executable = path.join(directory, "hook-mac-test");

/** Bound compiler/test execution; never start a hook or request OS permission. */
function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.signal ?? result.status}).`);
  }
}

try {
  run("xcrun", [
    "clang++",
    "-std=c++17",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-arch",
    "arm64",
    "-mmacosx-version-min=15.0",
    "-framework",
    "ApplicationServices",
    "-framework",
    "CoreFoundation",
    source,
    "-o",
    executable,
  ]);
  run(executable, []);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
