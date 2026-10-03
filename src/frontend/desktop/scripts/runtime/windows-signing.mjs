import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildRoot,
  cacheRoot,
  readJson,
  run,
  sha256,
  sourceRoot,
} from "./common.mjs";
import { assertPrivateWindowsDirectory, systemPath } from "./windows-acl.mjs";
import { pinnedTool } from "./windows-build.mjs";
import { isPortableExecutable } from "./windows-platform.mjs";

/**
 * Windows Authenticode signing through the pinned Windows SDK signtool and
 * the pinned Artifact Signing client library (proposal P-a). The client
 * authenticates through the maintainer's Azure CLI sign-in on the build host,
 * so no credential is ever passed on a command line or written to a file.
 */

export const signingLockFile = path.join(
  sourceRoot,
  "windows-signing.lock.json",
);

/** Every credential DefaultAzureCredential would try except the Azure CLI sign-in. */
const EXCLUDED_CREDENTIALS = [
  "EnvironmentCredential",
  "WorkloadIdentityCredential",
  "ManagedIdentityCredential",
  "SharedTokenCacheCredential",
  "VisualStudioCredential",
  "VisualStudioCodeCredential",
  "AzurePowerShellCredential",
  "AzureDeveloperCliCredential",
  "InteractiveBrowserCredential",
];

/** Each Artifact Signing request signs one file; batches only bound the command line. */
const BATCH = 20;

/**
 * Resolve and verify the pinned signing tools on this Windows host: the SDK
 * signtool by hash, the client library from its pinned package, the .NET
 * runtime the client needs, and the Azure CLI it authenticates through.
 */
export function signingTools(lock = readJson(signingLockFile)) {
  if (process.platform !== "win32")
    throw new Error("Windows signing runs only on a Windows host");
  const signtool = path.join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Windows Kits",
    "10",
    "bin",
    lock.signtool.windows_sdk,
    "x64",
    "signtool.exe",
  );
  if (!existsSync(signtool) || sha256(signtool) !== lock.signtool.sha256)
    throw new Error(
      `Install the Windows SDK ${lock.signtool.windows_sdk} signing tools; signtool ${lock.signtool.version} is pinned by hash`,
    );
  const client = lock.artifact_signing_client;
  const toolsRoot = path.join(buildRoot, "tools");
  assertPrivateWindowsDirectory(toolsRoot);
  const clientRoot = pinnedTool("artifact-signing-client", client, {
    downloads: path.join(cacheRoot, "downloads"),
    toolsRoot,
  });
  const dlib = path.join(clientRoot, ...client.dlib.split("/"));
  if (!existsSync(dlib) || sha256(dlib) !== client.dlib_sha256)
    throw new Error(
      "The Artifact Signing client library does not match its pin",
    );
  const runtimes = path.join(
    process.env.ProgramFiles || "C:\\Program Files",
    "dotnet",
    "shared",
    "Microsoft.NETCore.App",
  );
  if (
    !existsSync(runtimes) ||
    !readdirSync(runtimes).some((name) =>
      name.startsWith(`${client.dotnet_runtime_major}.`),
    )
  )
    throw new Error(
      `The Artifact Signing client needs the .NET ${client.dotnet_runtime_major} x64 runtime`,
    );
  try {
    run(systemPath("where.exe"), ["az"], { capture: true });
  } catch {
    throw new Error(
      "Install the Azure CLI and sign in with `az login`; Artifact Signing authenticates through that sign-in",
    );
  }
  return {
    signtool,
    dlib,
    timestampUrl: lock.timestamp_url,
    versions: { signtool: lock.signtool.version, client: client.version },
  };
}

/** Every PE file below `root` as a forward-slash relative path, sorted. */
export function portableExecutables(root, isPE = isPortableExecutable) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => isPE(file))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();
}

/**
 * Proposal P-b's order. Nested code under `resources` (the runtime and the
 * unpacked addon) is signed first, deepest first, so the runtime manifest can
 * be re-inventoried before the outer app; `Animama.exe` is signed last.
 */
export function signingOrder(files, executable = "Animama.exe") {
  const depthFirst = (a, b) =>
    b.split("/").length - a.split("/").length || (a < b ? -1 : a > b ? 1 : 0);
  const nested = files.filter((file) => file.startsWith("resources/"));
  const outer = files.filter(
    (file) => !file.startsWith("resources/") && file !== executable,
  );
  return {
    nested: nested.sort(depthFirst),
    outer: [
      ...outer.sort(depthFirst),
      ...(files.includes(executable) ? [executable] : []),
    ],
  };
}

/** signtool arguments: SHA-256 file and timestamp digests, signed through the pinned client. */
export function signtoolArguments(tools, metadata, files) {
  return [
    "sign",
    "/fd",
    "SHA256",
    "/tr",
    tools.timestampUrl,
    "/td",
    "SHA256",
    "/dlib",
    tools.dlib,
    "/dmdf",
    metadata,
    ...files,
  ];
}

/** Sign `files` (absolute paths); each one uses one Artifact Signing signature. */
export function signFiles(files, tools, publisher) {
  if (!files.length) return;
  const directory = mkdtempSync(path.join(tmpdir(), "animama-signing-"));
  try {
    // The client reads these names from a file; none of them is a secret.
    const metadata = path.join(directory, "metadata.json");
    writeFileSync(
      metadata,
      JSON.stringify({
        Endpoint: publisher.endpoint,
        CodeSigningAccountName: publisher.account,
        CertificateProfileName: publisher.certificate_profile,
        ExcludeCredentials: EXCLUDED_CREDENTIALS,
      }),
    );
    for (let index = 0; index < files.length; index += BATCH)
      signBatch(files.slice(index, index + BATCH), tools, metadata);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Size of a PE file's certificate table, which holds an embedded Authenticode
 * signature; 0 when the file carries none.
 */
export function certificateTableSize(file) {
  const bytes = readFileSync(file);
  const pe = bytes.readUInt32LE(0x3c);
  const optional = pe + 24;
  // PE32+ data directories start 112 bytes into the optional header, PE32 96.
  const directories =
    optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96);
  // Directory 4 is the certificate table: an offset, then a size.
  return bytes.readUInt32LE(directories + 4 * 8 + 4);
}

/**
 * A valid signature embedded in the file, which verifies on every machine.
 * Get-AuthenticodeSignature consults the system catalogs first, so its status
 * alone can be a catalog signature trusted only on this host; the certificate
 * table shows whether the file carries its own.
 */
export function hasEmbeddedSignature(signature) {
  return signature?.status === "Valid" && signature.embedded === true;
}

/** Check kept vendor files' own signatures with signtool, which reads no catalog. */
export function verifyEmbeddedSignatures(files, tools) {
  if (files.length)
    run(tools.signtool, ["verify", "/pa", ...files], { capture: true });
}

/**
 * signtool stops at the first file it cannot sign, often a transient
 * timestamp or network failure. Retry only the files not yet signed and
 * timestamped, since every request uses a signature, and give up after a few
 * attempts.
 */
function signBatch(files, tools, metadata, attempts = 3) {
  let pending = files;
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(tools.signtool, signtoolArguments(tools, metadata, pending), {
        capture: true,
      });
      return;
    } catch (error) {
      const state = readSignatures("", pending);
      pending = pending.filter(
        (file) =>
          !hasEmbeddedSignature(state.get(file)) ||
          !state.get(file).timestamped,
      );
      if (!pending.length) return;
      if (attempt === attempts) throw error;
      console.warn(
        `Signing failed; retrying ${pending.length} unsigned file(s) (attempt ${attempt + 1} of ${attempts})`,
      );
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        5000 * attempt,
      );
    }
  }
}

const SIGNATURE_SCRIPT = `
$ErrorActionPreference = "Stop"
$files = [IO.File]::ReadAllText($env:ANIMAMA_SIGNATURE_LIST) | ConvertFrom-Json
$out = foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  $certificate = $signature.SignerCertificate
  [pscustomobject]@{
    status = [string]$signature.Status
    subject = if ($certificate) { $certificate.Subject } else { $null }
    timestamped = [bool]$signature.TimeStamperCertificate
    eku = @(if ($certificate) { $certificate.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" } | ForEach-Object { $_.EnhancedKeyUsages } | ForEach-Object { $_.Value } })
  }
}
[IO.File]::WriteAllText($env:ANIMAMA_SIGNATURE_OUTPUT, (ConvertTo-Json -Depth 3 -Compress @($out)))
`;

/**
 * Read each file's Authenticode state with Get-AuthenticodeSignature. Paths
 * and results travel through UTF-8 files so non-ASCII paths survive.
 */
export function readSignatures(root, files) {
  const directory = mkdtempSync(path.join(tmpdir(), "animama-signatures-"));
  try {
    const list = path.join(directory, "files.json");
    const output = path.join(directory, "signatures.json");
    writeFileSync(
      list,
      JSON.stringify(files.map((file) => path.join(root, file))),
    );
    run(
      systemPath("WindowsPowerShell\\v1.0\\powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", SIGNATURE_SCRIPT],
      {
        capture: true,
        env: {
          ANIMAMA_SIGNATURE_LIST: list,
          ANIMAMA_SIGNATURE_OUTPUT: output,
        },
      },
    );
    const signatures = [JSON.parse(readFileSync(output, "utf8"))].flat();
    if (signatures.length !== files.length)
      throw new Error("Could not read every Authenticode signature");
    return new Map(
      files.map((file, index) => [
        file,
        {
          ...signatures[index],
          embedded: certificateTableSize(path.join(root, file)) > 0,
        },
      ]),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * One report entry. A file Animama signed must carry the pinned publisher's
 * subject and identity-validation EKU and a timestamp, since Artifact Signing
 * certificates last only days. A vendor's signature has to be valid and
 * embedded in the file.
 */
export function signatureEntry(file, digest, signature, publisher, ours) {
  const valid =
    hasEmbeddedSignature(signature) &&
    (!ours ||
      (signature.subject === publisher.certificate_subject &&
        signature.timestamped === true &&
        signature.eku?.includes(publisher.identity_validation_eku)));
  if (!valid)
    throw new Error(
      `${file} is not ${ours ? "validly signed and timestamped by the pinned publisher" : "validly signed"} (${signature?.status ?? "unread"}${signature?.embedded ? "" : ", no embedded signature"})`,
    );
  return {
    path: file,
    sha256: digest,
    signer: ours ? "animama" : "vendor",
    status: signature.status,
    subject: signature.subject,
    timestamped: signature.timestamped,
  };
}

/** A complete signed candidate: every PE valid, Animama's own entries pinned, the runtime re-inventoried. */
export function validateSigningReport(report, publisher) {
  const ours = (entry) =>
    entry?.signer === "animama" &&
    entry.status === "Valid" &&
    entry.timestamped === true &&
    entry.subject === publisher.certificate_subject;
  if (
    report?.schema !== "animama-windows-signing/1" ||
    !Array.isArray(report.files) ||
    !report.files.length
  )
    throw new Error("Invalid Windows signing report");
  for (const entry of report.files)
    if (
      entry?.status !== "Valid" ||
      (entry.signer !== "vendor" && !ours(entry))
    )
      throw new Error(`${entry?.path ?? "A file"} is not validly signed`);
  for (const name of ["installer", "uninstaller"])
    if (!ours(report[name]))
      throw new Error(`The ${name} is not signed by the pinned publisher`);
  if (
    report.signed_files !==
    report.files.filter((entry) => entry.signer === "animama").length + 2
  )
    throw new Error(
      "The report's count of signed files does not match its entries",
    );
  if (
    !/^[a-f0-9]{64}$/u.test(report.runtime_build_id ?? "") ||
    report.runtime_build_id === report.stage_build_id
  )
    throw new Error("The signed runtime was not re-inventoried");
  return report;
}
