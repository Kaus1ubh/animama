import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

function stat(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** A live or inaccessible PID blocks archival; stale PIDs never authorize killing. */
function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error(
      "Invalid desktop process record; inspect the profile before resetting.",
    );
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

/** Archive a stopped profile intact. Dependencies are injectable for disposable tests. */
export function resetMacosProfile({
  app,
  profile,
  platform = process.platform,
  alive = isAlive,
  processes = () =>
    execFileSync("/bin/ps", ["-axo", "comm="], { encoding: "utf8" }),
  launch = (bundle) =>
    execFileSync("/usr/bin/open", [bundle], { stdio: "inherit" }),
  report = console.log,
}) {
  if (platform !== "darwin")
    throw new Error("Desktop profile reset supports macOS only.");
  if (!stat(app)?.isDirectory())
    throw new Error(
      "Animama.app is missing. Run pnpm desktop:mac:build first.",
    );
  // The launcher would otherwise import the legacy profile instead of starting fresh.
  if (stat(path.join(path.dirname(profile), "Anima")))
    throw new Error(
      "A legacy Anima profile exists. Preserve and resolve it before resetting.",
    );
  if (/\/(?:Animama|Anima|Electron)\.app\/Contents\/MacOS\//u.test(processes()))
    throw new Error(
      "Quit Animama and Electron development apps completely before resetting.",
    );

  const info = stat(profile);
  let backup;
  if (info) {
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(
        "The desktop profile must be a real directory, not a symlink.",
      );
    for (const relative of [
      "runtime",
      "postgres",
      "postgres/16",
      "postgres/16/data",
    ]) {
      const entry = stat(path.join(profile, relative));
      if (entry && (!entry.isDirectory() || entry.isSymbolicLink()))
        throw new Error(`Unsafe profile directory: ${relative}`);
    }
    const pids = [];
    for (const relative of [
      "runtime/processes.json",
      "postgres/16/data/postmaster.pid",
    ]) {
      const file = path.join(profile, relative);
      const entry = stat(file);
      if (!entry) continue;
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 32768)
        throw new Error(`Unsafe process record: ${relative}`);
      const text = readFileSync(file, "utf8");
      if (relative.endsWith(".json")) {
        const record = JSON.parse(text);
        if (record.version !== 1 || !Array.isArray(record.children))
          throw new Error("Invalid desktop process record.");
        pids.push(...record.children.map((child) => child.pid));
      } else pids.push(Number(text.split("\n")[0]));
    }
    const lock = path.join(profile, "SingletonLock");
    if (stat(lock)) {
      if (!stat(lock).isSymbolicLink())
        throw new Error("Invalid desktop SingletonLock.");
      pids.push(Number(readlinkSync(lock).match(/-(\d+)$/u)?.[1]));
    }
    for (const pid of pids) {
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw new Error("Invalid desktop process ID.");
      if (alive(pid))
        throw new Error(
          "Desktop services are still running. Quit Animama before resetting.",
        );
    }
    backup = `${profile}.backup-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`;
    if (stat(backup)) throw new Error("Backup destination already exists.");
    renameSync(profile, backup);
    report(`Desktop profile preserved at: ${backup}`);
  } else report("No desktop profile exists; launching fresh setup.");
  // Never restore automatically after open fails: the application may have started writing.
  launch(app);
  return backup;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw new Error("This command accepts no path overrides or arguments.");
    resetMacosProfile({
      app: fileURLToPath(
        new URL("../release/mac/Animama.app", import.meta.url),
      ),
      profile: path.join(homedir(), "Library/Application Support/Animama"),
    });
  } catch (error) {
    console.error(`Desktop reset failed: ${error.message}`);
    process.exitCode = 1;
  }
}
