import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  constants,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { extractAll } from "@electron/asar";
import {
  buildPython,
  pythonEnvironment,
  readJson,
  repoRoot,
  run,
  sha256,
  writeJson,
} from "./common.mjs";
import { verifyArtifactIndex } from "./release-artifacts.mjs";

/** Messages the CLI may print: they never contain paths, output or values. */
export class ScanError extends Error {}

const MAX_NESTING = 4;
const MIN_STRING = 8;
// Gitleaks skips files whose first bytes look like PDF, SQLite, ZIP and similar
// formats. A fixed first line keeps every scan-view file eligible.
const VIEW_HEADER = "animama-scan-view\n";
const GITLEAKS_LEAKS_EXIT = 2;
const PYINSTALLER_COOKIE = Buffer.from("MEI\x0c\x0b\x0a\x0b\x0e", "latin1");
const MACHO_MAGIC = ["cffaedfe", "cefaedfe", "cafebabe", "bebafeca"];

const pins = () =>
  readJson(path.join(repoRoot, "scripts/repository-boundary/scanner-pins.json"))
    .gitleaks;

/** Members under root by kind; symlinks are listed, never followed. */
function members(root, relative = "", result = { files: [], links: [] }) {
  for (const name of readdirSync(path.join(root, relative)).sort()) {
    const member = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(path.join(root, member));
    if (stat.isDirectory()) members(root, member, result);
    else if (stat.isSymbolicLink()) result.links.push(member);
    else if (stat.isFile()) result.files.push(member);
  }
  return result;
}

function head(file, length) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, 0));
  } finally {
    closeSync(fd);
  }
}

/** Git's heuristic: a NUL byte near the start means binary content. */
const isBinary = (file) => head(file, 8000).includes(0);

/**
 * Report which labelled byte sequences occur in a file. Values stay with the
 * caller: a receipt records only labels, so a private path is never re-published.
 */
export async function searchNeedles(
  file,
  needles,
  { chunkBytes = 4 * 1024 * 1024 } = {},
) {
  const patterns = needles.map((needle) => ({
    label: needle.label,
    bytes: Buffer.from(needle.value),
  }));
  const overlap = Math.max(0, ...patterns.map((item) => item.bytes.length - 1));
  const found = new Set();
  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(chunkBytes + overlap);
  let carried = 0;
  try {
    for (;;) {
      const length = readSync(fd, buffer, carried, chunkBytes, null);
      if (!length) break;
      const view = buffer.subarray(0, carried + length);
      for (const item of patterns)
        if (!found.has(item.label) && view.includes(item.bytes))
          found.add(item.label);
      carried = Math.min(overlap, view.length);
      view.copy(buffer, 0, view.length - carried);
    }
  } finally {
    closeSync(fd);
  }
  return needles.map((item) => item.label).filter((label) => found.has(label));
}

/** Write each run of at least MIN_STRING printable ASCII bytes on its own line, like strings(1). */
export async function writePrintableRuns(file, output, header = "") {
  const out = createWriteStream(output);
  out.write(header);
  let pending = [];
  let pendingLength = 0;
  for await (const chunk of createReadStream(file)) {
    const runs = [];
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      const byte = chunk[index];
      if (byte === 9 || (byte >= 0x20 && byte < 0x7f)) continue;
      if (pendingLength + index - start >= MIN_STRING)
        runs.push(...pending, chunk.subarray(start, index), Buffer.from("\n"));
      pending = [];
      pendingLength = 0;
      start = index + 1;
    }
    if (start < chunk.length) {
      pending.push(chunk.subarray(start));
      pendingLength += chunk.length - start;
    }
    if (runs.length && !out.write(Buffer.concat(runs)))
      await once(out, "drain");
  }
  if (pendingLength >= MIN_STRING) out.write(Buffer.concat(pending));
  out.end();
  await once(out, "close");
}

/** Keep rule and location only; Gitleaks' Secret/Match fields never leave this process. */
export function gitleaksFindings(report, entries) {
  return report.map((finding) => {
    const entry = entries[Number.parseInt(path.basename(finding.File), 10)];
    if (!entry) throw new ScanError("Gitleaks reported an unknown file");
    return {
      source: "gitleaks",
      rule: String(finding.RuleID),
      artifact: entry.artifact,
      path: entry.path,
      view: entry.view,
      line: Math.max(0, (Number(finding.StartLine) || 0) - 1), // Skip VIEW_HEADER.
    };
  });
}

function runGitleaks(gitleaks, target, reportPath, config) {
  const result = spawnSync(
    gitleaks,
    [
      "dir",
      "--no-banner",
      "--redact",
      "--log-level",
      "error",
      "--exit-code",
      String(GITLEAKS_LEAKS_EXIT),
      "--report-format",
      "json",
      "--report-path",
      reportPath,
      ...(config ? ["--config", config] : []),
      target,
    ],
    { encoding: "utf8" },
  );
  // Gitleaks exits 1 on fatal errors, so leaks use a distinct code.
  if (
    result.error ||
    ![0, GITLEAKS_LEAKS_EXIT].includes(result.status) ||
    !existsSync(reportPath)
  )
    throw new ScanError(
      "Gitleaks did not complete; the candidate is not cleared",
    );
  return readJson(reportPath);
}

/** A scanner that cannot see a synthetic token cannot clear a candidate. */
function verifyCanary(gitleaks, work, config) {
  const directory = path.join(work, "canary");
  mkdirSync(directory);
  // GitHub tokens are strictly alphanumeric; base64url's -/_ would evade the rule.
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const token = `ghp_${[...randomBytes(36)].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
  writeFileSync(path.join(directory, "config.txt"), `token = "${token}"\n`);
  const report = runGitleaks(
    gitleaks,
    directory,
    path.join(work, "canary-report.json"),
    config,
  );
  if (!report.some((finding) => finding.RuleID === "github-pat"))
    throw new ScanError(
      "Gitleaks missed the synthetic canary; scan not accepted",
    );
}

/** External tools log to the work directory, so failures never print host paths. */
const tool = (work, command, args, env) =>
  run(command, args, { env, logFile: path.join(work, "tool.log") });

/** Which archive format, if any, this file is. */
async function archiveKind(file) {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith(".asar")) return "asar";
  if (name.endsWith(".tar.zst")) return "tar.zst";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "tar.gz";
  if (/\.(zip|whl|jar)$/u.test(name)) return "zip";
  if (!MACHO_MAGIC.includes(head(file, 4).toString("hex"))) return null;
  const [found] = await searchNeedles(file, [
    { label: "pyinstaller", value: PYINSTALLER_COOKIE },
  ]);
  return found ? "pyinstaller" : null;
}

async function expandArchive(kind, file, into, work) {
  mkdirSync(into);
  if (kind === "asar") extractAll(file, into);
  else if (kind === "zip") tool(work, "ditto", ["-x", "-k", file, into]);
  else if (kind === "tar.gz") tool(work, "tar", ["-xzf", file, "-C", into]);
  else if (kind === "tar.zst") {
    const tar = path.join(work, "pack.tar");
    await pipeline(
      createReadStream(file),
      createZstdDecompress(),
      createWriteStream(tar),
    );
    try {
      tool(work, "tar", ["-xf", tar, "-C", into]);
    } finally {
      rmSync(tar);
    }
  } else {
    if (!existsSync(buildPython()))
      throw new ScanError(
        "A PyInstaller archive needs the staged build interpreter; run desktop:runtime:stage first",
      );
    tool(
      work,
      buildPython(),
      [
        path.join(
          repoRoot,
          "src/backend/packaging/desktop/extract_pyinstaller.py",
        ),
        file,
        into,
      ],
      pythonEnvironment(),
    );
  }
}

/**
 * Expand every archive below root in place (`<archive>.expanded/`). Returns the
 * archive members whose content is now represented by their expansion.
 */
async function expandNested(root, work, depth = 0) {
  const expanded = [];
  for (const member of members(root).files) {
    const file = path.join(root, member);
    const kind = await archiveKind(file);
    if (!kind) continue;
    if (depth >= MAX_NESTING)
      throw new ScanError("Archives nest too deeply to scan completely");
    await expandArchive(kind, file, `${file}.expanded`, work);
    // A PyInstaller executable also holds bootloader code worth scanning.
    if (kind !== "pyinstaller") expanded.push(member);
    for (const inner of await expandNested(`${file}.expanded`, work, depth + 1))
      expanded.push(`${member}.expanded/${inner}`);
  }
  return expanded;
}

/** Materialize one artifact so every scanner sees its actual contents. */
async function materialize(file, destination, work) {
  mkdirSync(destination);
  if (path.basename(file).endsWith(".dmg")) {
    const mount = mkdtempSync(path.join(work, "mount-"));
    tool(work, "hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-noautoopen",
      "-mountpoint",
      mount,
      file,
    ]);
    try {
      tool(work, "ditto", [mount, destination]);
    } finally {
      try {
        tool(work, "hdiutil", ["detach", mount, "-quiet"]);
      } catch {
        tool(work, "hdiutil", ["detach", mount, "-force", "-quiet"]);
      }
    }
  } else {
    // APFS clones make this copy free; other filesystems fall back to a copy.
    copyFileSync(
      file,
      path.join(destination, path.basename(file)),
      constants.COPYFILE_FICLONE,
    );
  }
  return expandNested(destination, work);
}

/**
 * Gitleaks' built-in allowlist skips paths such as node_modules/, *.dist-info
 * and image extensions, and it ignores binary files. Present every member as a
 * numbered text file instead: text as-is, binaries as their printable strings.
 */
async function buildScanView(expanded, view, skip) {
  mkdirSync(view);
  const entries = [];
  const excluded = { onnx: 0 };
  for (const member of members(expanded).files) {
    if (skip.has(member)) continue;
    // Quantized weights are mostly printable bytes: token-shaped runs occur by
    // chance. The byte search for private text still covers these files.
    if (member.endsWith(".onnx")) {
      excluded.onnx++;
      continue;
    }
    const [artifact, ...rest] = member.split("/");
    const file = path.join(expanded, member);
    const target = path.join(view, `${entries.length}.txt`);
    const binary = isBinary(file);
    if (binary) await writePrintableRuns(file, target, VIEW_HEADER);
    else
      await pipeline(async function* () {
        yield Buffer.from(VIEW_HEADER);
        yield* createReadStream(file);
      }, createWriteStream(target));
    entries.push({
      artifact,
      path: rest.join("/"),
      view: binary ? "strings" : "text",
    });
  }
  return { entries, excluded };
}

async function privateTextFindings(expanded, needles, skip) {
  const findings = [];
  const { files, links } = members(expanded);
  for (const member of files) {
    if (skip.has(member)) continue;
    const [artifact, ...rest] = member.split("/");
    for (const rule of await searchNeedles(
      path.join(expanded, member),
      needles,
    ))
      findings.push({
        source: "private-text",
        rule,
        artifact,
        path: rest.join("/"),
      });
  }
  for (const member of links) {
    const [artifact, ...rest] = member.split("/");
    const target = readlinkSync(path.join(expanded, member));
    // Installer images link to /Applications for drag-to-install; any other
    // absolute or escaping relative target points outside the shipped artifact.
    const resolved = path.posix.join(
      path.posix.dirname(rest.join("/")),
      target,
    );
    const outside = path.isAbsolute(target)
      ? target !== "/Applications"
      : resolved === ".." || resolved.startsWith("../");
    const rules = [
      ...(outside ? ["symlink-outside-artifact"] : []),
      ...needles
        .filter((needle) => target.includes(needle.value))
        .map((needle) => needle.label),
    ];
    for (const rule of rules)
      findings.push({
        source: "symlink",
        rule,
        artifact,
        path: rest.join("/"),
      });
  }
  return findings;
}

/**
 * Scan an indexed release candidate for secrets and private text and write
 * `release-scan.json` beside it. The receipt names the exact files scanned so a
 * publisher can refuse bytes that were never cleared.
 */
export async function scanCandidate({
  directory,
  gitleaks,
  needles,
  config = null,
  workRoot,
}) {
  let index;
  try {
    index = verifyArtifactIndex(directory);
  } catch {
    throw new ScanError(
      "The candidate's release-artifacts.json is missing, invalid or does not match its files",
    );
  }
  const version = spawnSync(gitleaks, ["version"], { encoding: "utf8" });
  const expected = pins().version;
  if (version.status !== 0 || version.stdout.trim() !== expected)
    throw new ScanError(`Use the pinned Gitleaks ${expected}`);
  const work = mkdtempSync(path.join(workRoot, "animama-release-scan-"));
  try {
    verifyCanary(gitleaks, work, config);
    const expanded = path.join(work, "artifacts");
    mkdirSync(expanded);
    const skip = new Set();
    for (const file of index.files)
      for (const member of await materialize(
        path.join(directory, file.name),
        path.join(expanded, file.name),
        work,
      ))
        skip.add(`${file.name}/${member}`);
    const view = path.join(work, "view");
    const { entries, excluded } = await buildScanView(expanded, view, skip);
    const findings = [
      ...gitleaksFindings(
        runGitleaks(gitleaks, view, path.join(work, "report.json"), config),
        entries,
      ),
      ...(await privateTextFindings(expanded, needles, skip)),
    ];
    const receipt = {
      schema: "animama-release-scan/1",
      app_version: index.app_version,
      artifact_index_sha256: sha256(
        path.join(directory, "release-artifacts.json"),
      ),
      scanner: {
        name: "gitleaks",
        version: expected,
        config_sha256: config ? sha256(config) : null,
        canary: "detected",
      },
      private_text_labels: needles.map((needle) => needle.label),
      coverage: {
        expanded_archives: skip.size,
        text_files: entries.filter((entry) => entry.view === "text").length,
        binary_files_as_strings: entries.filter(
          (entry) => entry.view === "strings",
        ).length,
        excluded_from_gitleaks: excluded,
      },
      files: index.files.map(({ name, sha256: digest }) => ({
        name,
        sha256: digest,
      })),
      findings,
      result: findings.length ? "fail" : "pass",
    };
    writeJson(path.join(directory, "release-scan.json"), receipt);
    return receipt;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
