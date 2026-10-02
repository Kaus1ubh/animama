import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { downloadVerified, run, systemTool } from "./common.mjs";

/** Parse `set` output from a cmd.exe session into an environment object. */
export function parseEnvironmentBlock(output) {
  const env = {};
  for (const line of output.split(/\r?\n/u)) {
    const index = line.indexOf("=");
    if (index > 0) env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

/** The cl.exe banner is the authoritative compiler identity, not the install folder. */
export function compilerVersion(banner) {
  const version = banner.match(
    /Compiler Version (\d+\.\d+\.\d+)(?:\.\d+)? for x64/u,
  )?.[1];
  if (!version) throw new Error("Could not identify the x64 MSVC compiler");
  return version;
}

/** Windows environment names are case-insensitive; return the actual key. */
export function environmentKey(env, name) {
  return (
    Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase()) ??
    name
  );
}

/** Put pinned tools first so a developer's PATH cannot substitute another copy. */
export function prependPath(env, directories) {
  const key = environmentKey(env, "PATH");
  return {
    ...env,
    [key]: [...directories, env[key]].filter(Boolean).join(path.delimiter),
  };
}

/**
 * Enter the pinned MSVC toolset through vcvars64.bat, the documented way to
 * obtain its compiler, SDK and redistributable paths, then verify the result.
 */
export function msvcEnvironment(toolchain) {
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  // A newer Visual Studio may lack the pinned toolset; use one that has it.
  const install = run(
    vswhere,
    [
      "-all",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
      "-utf8",
    ],
    { capture: true },
  )
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(
      (candidate) =>
        candidate &&
        existsSync(
          path.join(candidate, "VC", "Tools", "MSVC", toolchain.msvc_tools),
        ),
    );
  if (!install)
    throw new Error(
      `Visual Studio with the MSVC ${toolchain.msvc_tools} x64 toolset is required`,
    );
  const vcvars = path.join(install, "VC", "Auxiliary", "Build", "vcvars64.bat");
  // A .bat file runs only through cmd.exe. Every argument is a fixed path or a
  // locked version, so verbatim quoting cannot introduce another command.
  // /u makes `set` write UTF-16, so non-ASCII profile paths survive the
  // console code page. VSLANG keeps dumpbin output in the parsed English form.
  const result = spawnSync(
    process.env.ComSpec || systemTool("cmd"),
    [
      "/d",
      "/u",
      "/s",
      "/c",
      `""${vcvars}" -vcvars_ver=${toolchain.msvc_tools} >nul && set"`,
    ],
    { encoding: "utf16le", windowsVerbatimArguments: true },
  );
  if (result.status !== 0)
    throw new Error(`MSVC ${toolchain.msvc_tools} is not installed`);
  const env = { ...parseEnvironmentBlock(result.stdout), VSLANG: "1033" };
  const banner = spawnSync("cl.exe", [], { env, encoding: "utf8" });
  const cl = compilerVersion(`${banner.stderr}${banner.stdout}`);
  const redist = path.basename(
    path.normalize(env[environmentKey(env, "VCToolsRedistDir")] ?? ""),
  );
  const sdk = (env[environmentKey(env, "WindowsSDKVersion")] ?? "").replace(
    /\\$/u,
    "",
  );
  if (cl !== toolchain.cl_version)
    throw new Error(
      `Expected MSVC compiler ${toolchain.cl_version}, found ${cl}`,
    );
  if (redist !== toolchain.msvc_redist)
    throw new Error(
      `Expected MSVC redistributable ${toolchain.msvc_redist}, found ${redist || "none"}`,
    );
  if (sdk !== toolchain.windows_sdk)
    throw new Error(
      `Expected Windows SDK ${toolchain.windows_sdk}, found ${sdk || "none"}`,
    );
  return { env, cl, redist, sdk };
}

/**
 * Download and unpack one pinned build tool into the private build root. A
 * multi-call executable such as busybox is copied once per applet name, which
 * selects the applet it runs.
 */
export function pinnedTool(name, tool, { downloads, toolsRoot }) {
  // The digest names the directory, so a changed pin never reuses old files.
  const directory = path.join(
    toolsRoot,
    `${name}-${tool.version}-${tool.sha256.slice(0, 12)}`,
  );
  const archive = downloadVerified(
    tool.url,
    tool.sha256,
    path.join(downloads, path.basename(new URL(tool.url).pathname)),
  );
  const complete = path.join(directory, ".animama-complete");
  if (!existsSync(complete)) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    if (tool.applets)
      for (const applet of tool.applets)
        copyFileSync(archive, path.join(directory, `${applet}.exe`));
    // Wheels are ZIP archives; Windows bsdtar reads ZIP and tar formats.
    else run(systemTool("tar"), ["-xf", archive, "-C", directory]);
    writeFileSync(complete, "");
  }
  return directory;
}
