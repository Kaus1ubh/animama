import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  buildPython,
  buildRoot,
  cacheRoot,
  downloadVerified,
  filesIn,
  nativeLockFile,
  normalizeTree,
  readJson,
  repoRoot,
  run,
  sha256,
  syncBuildEnvironment,
  systemTool,
  writeJson,
} from "./common.mjs";
import { assertPrivateWindowsDirectory } from "./windows-acl.mjs";
import {
  environmentKey,
  msvcEnvironment,
  pinnedTool,
  prependPath,
} from "./windows-build.mjs";
import {
  assertNoEmbeddedPaths,
  auditWindowsDependencies,
  dumpbinDependents,
} from "./windows-platform.mjs";

// PostgreSQL compiles its configured directories in and relocates them relative
// to bin\ at runtime. Install below a neutral prefix through DESTDIR so build
// paths never ship. pgvector's Makefile.win expects the flat layout that a
// prefix containing "pgsql" selects (lib\, share\extension\, include\server\).
const INSTALL_PREFIX = "C:/animama/pgsql";
// PostgreSQL opens files through ANSI APIs, which cannot name a profile path
// outside the active code page. A UTF-8 active code page makes those APIs
// accept every path (Windows 10 1903 and later).
const UTF8_MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
    </windowsSettings>
  </application>
</assembly>
`;
// The VC++ runtime must ship beside the executables that import it; a copy in
// System32 on the build machine is not evidence that users have one.
const VC_RUNTIME =
  /^(?:vcruntime140(?:_1)?|msvcp140(?:_\w+)?|concrt140)\.dll$/u;

/** Build the locked PostgreSQL and pgvector sources with the pinned MSVC toolset. */
export function buildPostgresWindows(target) {
  const lockFile = nativeLockFile(target);
  const lock = readJson(lockFile);
  if (lock.target !== target.target)
    throw new Error("No native component lock for this target");
  syncBuildEnvironment();
  const toolsRoot = path.join(buildRoot, "tools");
  assertPrivateWindowsDirectory(toolsRoot);
  const downloads = path.join(cacheRoot, "downloads");
  // MSVC embeds absolute source paths (__FILE__ and flex/bison #line names), so
  // compile below the fixed neutral build root rather than the checkout.
  assertPrivateWindowsDirectory(path.join(buildRoot, "native-build"));
  const work = path.join(buildRoot, "native-build", target.target);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const tools = Object.fromEntries(
    Object.entries(lock.build_tools).map(([name, tool]) => [
      name,
      pinnedTool(name, tool, { downloads, toolsRoot }),
    ]),
  );
  const perl = path.join(
    tools.strawberry_perl,
    lock.build_tools.strawberry_perl.executable,
  );
  const flexBison = tools.win_flex_bison;
  const ninja = path.join(tools.ninja, lock.build_tools.ninja.executable);
  const msvc = msvcEnvironment(lock.toolchain);
  // Only perl\bin joins PATH: Strawberry's c\bin holds a MinGW toolchain that
  // must never be found in place of MSVC.
  const env = {
    ...prependPath(msvc.env, [path.dirname(ninja), path.dirname(perl)]),
    PYTHONPATH: tools.meson,
    NINJA: ninja,
    CC: "cl",
    // link.exe reads extra options from LINK. PostgreSQL compiles its meson
    // link arguments into pg_config output, so this flag cannot go there.
    LINK: lock.postgresql.link,
  };
  const mesonArgs = (args) => ["-m", "mesonbuild.mesonmain", ...args];
  const meson = (args, cwd) =>
    run(buildPython(), mesonArgs(args), { cwd, env });

  for (const [name, component] of [
    ["postgresql", lock.postgresql],
    ["pgvector", lock.pgvector],
  ]) {
    const suffix = name === "postgresql" ? "tar.bz2" : "tar.gz";
    const archive = downloadVerified(
      component.url,
      component.sha256,
      path.join(downloads, `${name}-${component.version}.${suffix}`),
    );
    run(systemTool("tar"), ["-xf", archive, "-C", work]);
  }
  const pg = path.join(work, `postgresql-${lock.postgresql.version}`);
  const vector = path.join(work, `pgvector-${lock.pgvector.version}`);
  const builddir = path.join(work, "build");
  const destdir = path.join(work, "destdir");
  const setup = [
    "setup",
    builddir,
    pg,
    `--prefix=${INSTALL_PREFIX}`,
    `-DPERL=${perl}`,
    `-DPYTHON=${buildPython()}`,
    `-DSED=${path.join(tools.busybox, "sed.exe")}`,
    `-DGZIP=${path.join(tools.busybox, "gzip.exe")}`,
    `-DTAR=${systemTool("tar")}`,
    `-DFLEX=${path.join(flexBison, lock.build_tools.win_flex_bison.flex)}`,
    `-DBISON=${path.join(flexBison, lock.build_tools.win_flex_bison.bison)}`,
    ...lock.postgresql.meson,
  ];
  // Meson rejects the release tarball's prebuilt parser and header outputs
  // because it regenerates them. Remove exactly the files it names, once.
  const first = spawnSync(buildPython(), mesonArgs(setup), {
    cwd: work,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (first.status !== 0) {
    const stale = distprepConflicts(`${first.stdout}${first.stderr}`, pg);
    if (!stale.length) {
      process.stderr.write(`${first.stdout}${first.stderr}`.slice(-6000));
      throw new Error("PostgreSQL meson setup failed");
    }
    for (const relative of stale) rmSync(path.join(pg, relative));
    rmSync(builddir, { recursive: true, force: true });
    meson(setup, work);
  }
  meson(["compile", "-C", builddir], work);
  meson(
    ["install", "-C", builddir, "--no-rebuild", "--destdir", destdir],
    work,
  );
  const prefix = installedRoot(destdir);
  // Meson names the backend's import library postgres.exe.lib; pgvector's
  // Makefile.win links extensions against postgres.lib.
  copyFileSync(
    path.join(prefix, "lib", "postgres.exe.lib"),
    path.join(prefix, "lib", "postgres.lib"),
  );
  run(
    "nmake",
    [
      "/NOLOGO",
      "/F",
      "Makefile.win",
      `PGROOT=${prefix}`,
      ...lock.pgvector.nmake,
    ],
    { cwd: vector, env },
  );
  run(
    "nmake",
    [
      "/NOLOGO",
      "/F",
      "Makefile.win",
      `PGROOT=${prefix}`,
      ...lock.pgvector.nmake,
      "install",
    ],
    { cwd: vector, env },
  );
  return stagePostgresWindows(target, lock, {
    lockFile,
    work,
    prefix,
    pg,
    vector,
    msvc,
    env,
    tools: lock.build_tools,
  });
}

/**
 * Source-relative files that meson reports as conflicting with its generated
 * outputs. Every name must be an existing regular file below the source tree.
 */
export function distprepConflicts(output, sourceDir, exists = isFile) {
  if (!output.includes("Non-clean source code directory detected")) return [];
  const listing = output.match(
    /Conflicting files in source directory:\r?\n\s*(.+)\r?\n/u,
  )?.[1];
  if (!listing) return [];
  const prefix = `${sourceDir.replaceAll("\\", "/")}/`;
  if (!listing.startsWith(prefix))
    throw new Error("Meson reported conflicts outside the PostgreSQL source");
  const names = listing
    .split(prefix)
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names)
    if (
      name.includes("\\") ||
      name.split("/").some((part) => part === ".." || !part) ||
      !exists(path.join(sourceDir, name))
    )
      throw new Error(`Unexpected meson conflict: ${name}`);
  return names;
}

function isFile(file) {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
}

/** Meson strips the drive letter when it joins DESTDIR and an absolute prefix. */
function installedRoot(destdir) {
  return path.join(destdir, INSTALL_PREFIX.replace(/^[A-Za-z]:/u, ""));
}

/** Keep the server/client closure and builtin language, text and encoding support. */
function stagePostgresWindows(target, lock, build) {
  const { prefix } = build;
  const dest = path.join(target.runtime, "postgres");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.join(dest, "bin"), { recursive: true });
  mkdirSync(path.join(dest, "lib"), { recursive: true });
  for (const binary of lock.executables)
    copyFileSync(
      path.join(prefix, "bin", `${binary}.exe`),
      path.join(dest, "bin", `${binary}.exe`),
    );
  copyFileSync(
    path.join(prefix, "bin", "libpq.dll"),
    path.join(dest, "bin", "libpq.dll"),
  );
  const manifest = path.join(build.work, "utf8-code-page.manifest");
  writeFileSync(manifest, UTF8_MANIFEST);
  for (const binary of lock.executables)
    run(
      "mt",
      [
        "-nologo",
        "-manifest",
        manifest,
        `-outputresource:${path.join(dest, "bin", `${binary}.exe`)};#1`,
      ],
      { env: build.env },
    );
  const libraries = path.join(prefix, "lib");
  for (const file of readdirSync(libraries)) {
    const name = file.toLowerCase();
    if (
      lock.extensions.some((extension) => name === `${extension}.dll`) ||
      name === "plpgsql.dll" ||
      name === "dict_snowball.dll" ||
      /(?:_and_|euc2004_sjis2004).*\.dll$/u.test(name)
    )
      copyFileSync(path.join(libraries, file), path.join(dest, "lib", file));
  }
  cpSync(path.join(prefix, "share"), path.join(dest, "share"), {
    recursive: true,
  });
  const ext = path.join(dest, "share", "extension");
  for (const file of filesIn(ext)) {
    if (
      ![...lock.extensions, "plpgsql"].some(
        (name) => file === `${name}.control` || file.startsWith(`${name}--`),
      )
    )
      rmSync(path.join(ext, file));
  }

  const symbols = path.join(target.output, "symbols", "postgres");
  rmSync(symbols, { recursive: true, force: true });
  mkdirSync(symbols, { recursive: true });
  for (const file of filesIn(prefix).filter((name) => name.endsWith(".pdb")))
    copyFileSync(
      path.join(prefix, file),
      path.join(symbols, path.basename(file)),
    );

  const redist = path.join(
    build.msvc.env[environmentKey(build.msvc.env, "VCToolsRedistDir")],
    "x64",
    "Microsoft.VC143.CRT",
  );
  // Discover which runtime DLLs the build imports, ship exactly those beside
  // the executables, then audit the final closure.
  const vcRuntime = new Set();
  for (const file of filesIn(dest).filter((name) =>
    /\.(?:exe|dll)$/u.test(name),
  ))
    for (const dependency of dumpbinDependents(path.join(dest, file), {
      env: build.env,
    }))
      if (VC_RUNTIME.test(dependency)) vcRuntime.add(dependency);
  const runtimeFiles = [];
  for (const name of [...vcRuntime].sort()) {
    const source = path.join(redist, name);
    if (!existsSync(source))
      throw new Error(`The pinned MSVC redistributable has no ${name}`);
    copyFileSync(source, path.join(dest, "bin", name));
    runtimeFiles.push({ name, sha256: sha256(source) });
  }
  // Extension DLLs load into postgres.exe, so bin\ is their application directory.
  const dependencies = auditWindowsDependencies(dest, filesIn(dest), {
    searchDirs: ["bin"],
    systemDlls: lock.system_dlls,
    env: build.env,
  });
  assertNoEmbeddedPaths(
    dest,
    filesIn(dest).filter((name) => /\.(?:exe|dll)$/u.test(name)),
    [repoRoot, homedir()],
  );

  const licenseDir = path.join(target.runtime, "licenses", "native");
  mkdirSync(licenseDir, { recursive: true });
  for (const [name, folder, item] of [
    ["postgresql", build.pg, lock.postgresql],
    ["pgvector", build.vector, lock.pgvector],
  ])
    cpSync(
      path.join(folder, item.license_file),
      path.join(licenseDir, `${name}.txt`),
    );
  writeJson(path.join(target.output, "native-dependencies.json"), {
    schema: "animama-windows-dependencies/1",
    target: target.target,
    files: dependencies,
  });
  writeJson(path.join(target.output, "native-build.json"), {
    lock_sha256: sha256(build.lockFile),
    target: target.target,
    compiler: `MSVC ${build.msvc.cl}`,
    sdk: build.msvc.sdk,
    msvc_redist: build.msvc.redist,
    vc_runtime: runtimeFiles,
    build_tools: Object.fromEntries(
      Object.entries(build.tools).map(([name, tool]) => [name, tool.version]),
    ),
    system_libraries_only: true,
  });
  normalizeTree(dest);
  return lock;
}
