import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMacosProfile } from "../scripts/reset-macos-profile.mjs";

let root, app, profile, options;
function write(relative, contents) {
  const file = path.join(profile, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}
function expectUntouched(action, message) {
  expect(action).toThrow(message);
  expect(readFileSync(path.join(profile, "content.txt"), "utf8")).toBe(
    "keep me",
  );
  expect(
    readdirSync(root).filter((entry) => entry.includes(".backup-")),
  ).toEqual([]);
  expect(options.launch).not.toHaveBeenCalled();
}
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "animama-reset-test-"));
  app = path.join(root, "Animama.app");
  profile = path.join(root, "Animama");
  mkdirSync(app);
  mkdirSync(profile);
  write("content.txt", "keep me");
  options = {
    app,
    profile,
    platform: "darwin",
    alive: vi.fn(() => false),
    processes: vi.fn(() => ""),
    launch: vi.fn(),
    report: vi.fn(),
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// A macOS-only tool whose fixtures rely on POSIX symbolic links.
describe.skipIf(process.platform === "win32")(
  "macOS desktop profile reset",
  () => {
    it("builds successfully before resetting in the combined pnpm command", () => {
      const desktop = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      );
      const workspace = JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      );
      expect(desktop.scripts["reset:mac:build"]).toBe(
        "pnpm build:mac && pnpm reset:mac",
      );
      expect(workspace.scripts["desktop:mac:reset:build"]).toBe(
        "pnpm --filter animama-desktop reset:mac:build",
      );
    });
    it("archives the whole profile including migration snapshot before launching", () => {
      write("backups/pre-migration/before.dump", "snapshot bytes");
      write("credentials/vault", "encrypted credentials");
      options.launch.mockImplementation(() =>
        expect(existsSync(profile)).toBe(false),
      );
      const backup = resetMacosProfile(options);
      expect(backup.startsWith(`${profile}.backup-`)).toBe(true);
      expect(readFileSync(path.join(backup, "content.txt"), "utf8")).toBe(
        "keep me",
      );
      expect(
        readFileSync(
          path.join(backup, "backups/pre-migration/before.dump"),
          "utf8",
        ),
      ).toBe("snapshot bytes");
      expect(readFileSync(path.join(backup, "credentials/vault"), "utf8")).toBe(
        "encrypted credentials",
      );
      expect(options.launch).toHaveBeenCalledWith(app);
      expect(options.report).toHaveBeenCalledWith(
        `Desktop profile preserved at: ${backup}`,
      );
    });
    it("launches first setup when the profile is absent", () => {
      rmSync(profile, { recursive: true });
      expect(resetMacosProfile(options)).toBeUndefined();
      expect(options.launch).toHaveBeenCalledWith(app);
      expect(existsSync(profile)).toBe(false);
    });
    it.each(["Animama", "Anima", "Electron"])(
      "refuses a running %s app",
      (name) => {
        options.processes.mockReturnValue(
          `/Applications/${name}.app/Contents/MacOS/${name}\n`,
        );
        expectUntouched(() => resetMacosProfile(options), /Quit Animama/);
      },
    );
    it.each(["child", "postmaster", "singleton"])(
      "refuses a live %s process",
      (kind) => {
        if (kind === "child")
          write(
            "runtime/processes.json",
            JSON.stringify({ version: 1, children: [{ pid: 123 }] }),
          );
        if (kind === "postmaster")
          write("postgres/16/data/postmaster.pid", "123\ncluster\n");
        if (kind === "singleton")
          symlinkSync("hostname-123", path.join(profile, "SingletonLock"));
        options.alive.mockReturnValue(true);
        expectUntouched(() => resetMacosProfile(options), /still running/);
        expect(options.alive).toHaveBeenCalledWith(123);
      },
    );
    it("allows stale records and preserves them in the backup", () => {
      write(
        "runtime/processes.json",
        JSON.stringify({ version: 1, children: [{ pid: 123 }] }),
      );
      write("postgres/16/data/postmaster.pid", "456\ncluster\n");
      symlinkSync("hostname-789", path.join(profile, "SingletonLock"));
      const backup = resetMacosProfile(options);
      expect(options.alive.mock.calls.map(([pid]) => pid)).toEqual([
        123, 456, 789,
      ]);
      expect(existsSync(path.join(backup, "runtime/processes.json"))).toBe(
        true,
      );
    });
    it.each([
      ["runtime/processes.json", "not JSON"],
      ["runtime/processes.json", '{"version":2,"children":[]}'],
      ["runtime/processes.json", '{"version":1,"children":[{"pid":0}]}'],
      ["runtime/processes.json", '{"version":1,"children":[{"pid":"123"}]}'],
      ["postgres/16/data/postmaster.pid", "bad pid\n"],
      ["SingletonLock", "not a lock symlink"],
    ])("refuses malformed process record %s (%s)", (file, text) => {
      write(file, text);
      expectUntouched(() => resetMacosProfile(options));
    });
    it("refuses malformed singleton PID", () => {
      symlinkSync("hostname-invalid", path.join(profile, "SingletonLock"));
      expectUntouched(
        () => resetMacosProfile(options),
        /Invalid desktop process ID/,
      );
    });
    it("refuses a symlinked profile", () => {
      const link = path.join(root, "profile-link");
      symlinkSync(profile, link);
      expectUntouched(
        () => resetMacosProfile({ ...options, profile: link }),
        /real directory/,
      );
    });
    it.each(["runtime", "postgres", "postgres/16", "postgres/16/data"])(
      "refuses symlinked %s directory",
      (relative) => {
        const target = path.join(root, "external");
        mkdirSync(target);
        mkdirSync(path.dirname(path.join(profile, relative)), {
          recursive: true,
        });
        symlinkSync(target, path.join(profile, relative));
        expectUntouched(
          () => resetMacosProfile(options),
          /Unsafe profile directory/,
        );
      },
    );
    it.each(["runtime/processes.json", "postgres/16/data/postmaster.pid"])(
      "refuses symlinked %s record",
      (relative) => {
        const target = path.join(root, "external-record");
        writeFileSync(target, "123");
        mkdirSync(path.dirname(path.join(profile, relative)), {
          recursive: true,
        });
        symlinkSync(target, path.join(profile, relative));
        expectUntouched(
          () => resetMacosProfile(options),
          /Unsafe process record/,
        );
      },
    );
    it("refuses a legacy Anima profile that would otherwise be imported", () => {
      mkdirSync(path.join(root, "Anima"));
      expectUntouched(() => resetMacosProfile(options), /legacy Anima profile/);
    });
    it("refuses a missing app before archiving", () => {
      rmSync(app, { recursive: true });
      expectUntouched(
        () => resetMacosProfile(options),
        /Animama.app is missing/,
      );
    });
    it("refuses other platforms before archiving", () => {
      expectUntouched(
        () => resetMacosProfile({ ...options, platform: "linux" }),
        /macOS only/,
      );
    });
    it("preserves backup and any new profile when launch fails", () => {
      options.launch.mockImplementation(() => {
        write("new-content.txt", "new profile");
        throw new Error("open failed");
      });
      expect(() => resetMacosProfile(options)).toThrow("open failed");
      const backups = readdirSync(root).filter((entry) =>
        entry.startsWith("Animama.backup-"),
      );
      expect(backups).toHaveLength(1);
      expect(
        readFileSync(path.join(root, backups[0], "content.txt"), "utf8"),
      ).toBe("keep me");
      expect(readFileSync(path.join(profile, "new-content.txt"), "utf8")).toBe(
        "new profile",
      );
    });
    it("preserves separate backups on repeated resets", () => {
      const first = resetMacosProfile(options);
      write("content.txt", "second profile");
      const second = resetMacosProfile(options);
      expect(first).not.toBe(second);
      expect(readFileSync(path.join(first, "content.txt"), "utf8")).toBe(
        "keep me",
      );
      expect(readFileSync(path.join(second, "content.txt"), "utf8")).toBe(
        "second profile",
      );
    });
  },
);
