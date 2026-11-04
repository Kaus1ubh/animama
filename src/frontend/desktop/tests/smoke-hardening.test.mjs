import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_WINDOWS_DATA_ROOT as appBudget } from "../src/main-process/runtime/paths.ts";
import { debuggingSwitches } from "../src/main-process/security/debugging-switches.ts";
import { desktopRoot } from "../scripts/runtime/common.mjs";
import {
  debuggingLaunches,
  debuggingLaunchesRefused,
  MAX_WINDOWS_DATA_ROOT,
  profileUnused,
  smokeCopyDirectory,
} from "../scripts/runtime/smoke-hardening.mjs";
import { hardeningSmokeChecks } from "../scripts/runtime/smoke-policy.mjs";
import { windowsCopyLocation } from "../scripts/runtime/smoke-windows.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function profile() {
  const root = mkdtempSync(path.join(tmpdir(), "animama-smoke-profile-"));
  roots.push(root);
  return root;
}

describe("installed-artifact smoke hardening", () => {
  it("launches every switch the packaged guard refuses, with and without a value", () => {
    for (const name of debuggingSwitches) {
      expect(debuggingLaunches).toContain(`--${name}`);
      expect(
        debuggingLaunches.some((arg) => arg.startsWith(`--${name}=`)),
      ).toBe(true);
    }
    expect(
      debuggingLaunches.every((arg) =>
        debuggingSwitches.includes(arg.slice(2).split("=")[0]),
      ),
    ).toBe(true);
  });

  it("passes only when every launch exits promptly with a failure and leaves nothing", () => {
    const userData = profile();
    const launches = [];
    const check = (result, options = {}) =>
      debuggingLaunchesRefused({
        executable: "/Applications/Animama.app/Contents/MacOS/Animama",
        env: { PATH: "/usr/bin:/bin" },
        userData,
        noInstalledProcesses: () => true,
        spawn: (_executable, args) => {
          launches.push(args[0]);
          return typeof result === "function" ? result(args[0]) : result;
        },
        settleMs: 50,
        ...options,
      });

    expect(check({ status: 1 })).toBe(true);
    expect(launches).toEqual(debuggingLaunches);
    expect(check((arg) => ({ status: arg === "--inspect-wait" ? 0 : 1 }))).toBe(
      false,
    );
    // A launch that never exits is killed at the timeout and has no status.
    expect(check({ status: null, signal: "SIGTERM" })).toBe(false);
    expect(check({ status: null, error: new Error("spawn failed") })).toBe(
      false,
    );
    expect(check({ status: 1 }, { noInstalledProcesses: () => false })).toBe(
      false,
    );
    // Chromium's own debugging-port file is not the app's start-up.
    writeFileSync(path.join(userData, "DevToolsActivePort"), "0\n");
    expect(check({ status: 1 })).toBe(true);
    writeFileSync(path.join(userData, "Local State"), "{}");
    expect(check({ status: 1 })).toBe(false);
  });

  it("makes the copy in a new folder outside the checkout", () => {
    const base = realpathSync(profile());
    const directory = smokeCopyDirectory(base, "animama-smoke-copy-");

    expect(path.dirname(directory)).toBe(base);
    expect(profileUnused(directory)).toBe(true);
    expect(profileUnused(path.join(base, "absent"))).toBe(true);
    expect(() =>
      smokeCopyDirectory(desktopRoot, "animama-smoke-copy-"),
    ).toThrow("outside the checkout");
  });

  it("keeps the Windows throwaway profile within the app's data-root budget", () => {
    expect(MAX_WINDOWS_DATA_ROOT).toBe(appBudget);
    const made = [];
    const make = (base, prefix) => {
      made.push(base);
      return path.win32.join(base, `${prefix}Ab12Cd`);
    };
    const resolve = (value) => value;

    expect(
      windowsCopyLocation("C:\\Users\\smoke\\AppData\\Local", {
        make,
        resolve,
      }),
    ).toEqual({
      directory: "C:\\Users\\smoke\\AppData\\Local\\am-smoke-Ab12Cd",
      profile: "C:\\Users\\smoke\\AppData\\Local\\am-smoke-Ab12Cd\\p",
    });
    const long = `C:\\Users\\${"x".repeat(40)}\\AppData\\Local`;
    expect(() => windowsCopyLocation(long, { make, resolve })).toThrow(
      "shorter profile folder",
    );
    // Nothing is created when the path would not fit.
    expect(made).toEqual(["C:\\Users\\smoke\\AppData\\Local"]);
  });

  it("makes publication require every hardening check", () => {
    expect(hardeningSmokeChecks).toEqual([
      "exact_fuse_wire",
      "publisher_signature",
      "sealed_update_policy",
      "debugging_switches_refused",
      "copy_fuse_wire",
      "copy_updates_unavailable",
      "canonical_profile_untouched",
    ]);
  });
});
