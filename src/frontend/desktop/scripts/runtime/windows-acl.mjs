import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

const SYSTEM = "S-1-5-18";
const ADMINISTRATORS = "S-1-5-32-544";
// FileSystemRights bits that let a principal change a directory's contents or
// permissions: write/append data, extended attributes, delete child,
// attributes, delete, change permissions, take ownership, generic write/all.
const MODIFY_RIGHTS =
  0x2 |
  0x4 |
  0x10 |
  0x40 |
  0x100 |
  0x10000 |
  0x40000 |
  0x80000 |
  0x10000000 |
  0x40000000;

// Report SIDs, not localized account names. The path arrives through the
// environment so it is never interpolated into PowerShell source.
const ACL_SCRIPT = `$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.SecurityIdentifier]
$acl = Get-Acl -LiteralPath $env:ANIMAMA_ACL_PATH
[pscustomobject]@{
  user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  owner = $acl.GetOwner($sid).Value
  rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object {
    [pscustomobject]@{ sid = $_.IdentityReference.Value; rights = [int64]$_.FileSystemRights; allow = ($_.AccessControlType -eq 'Allow') }
  })
} | ConvertTo-Json -Compress -Depth 4`;

/** A Windows program from System32, never a PATH lookup. */
export function systemPath(name) {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32", name);
}

function capture(command, args, env = {}) {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed (status ${result.status})`,
    );
  return result.stdout;
}

function readAcl(directory) {
  return JSON.parse(
    capture(
      systemPath("WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", ACL_SCRIPT],
      { ANIMAMA_ACL_PATH: directory },
    ),
  );
}

/** Principals other than this user, SYSTEM and Administrators that can modify. */
export function untrustedWriters(acl) {
  const trusted = new Set([acl.user, SYSTEM, ADMINISTRATORS]);
  const owners = [acl.user, ADMINISTRATORS];
  const writers = acl.rules
    .filter((rule) => rule.allow && !trusted.has(rule.sid))
    .filter((rule) => rule.rights & MODIFY_RIGHTS)
    .map((rule) => rule.sid);
  if (!owners.includes(acl.owner)) writers.unshift(`owner ${acl.owner}`);
  return [...new Set(writers)];
}

/**
 * New folders below C:\ inherit Authenticated Users modify rights, so create
 * build directories with an explicit, non-inherited ACL and refuse existing
 * ones that are links or that other accounts could change.
 */
export function assertPrivateWindowsDirectory(directory) {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
    const { user } = readAcl(directory);
    capture(systemPath("icacls.exe"), [
      directory,
      "/inheritance:r",
      "/grant:r",
      `*${user}:(OI)(CI)F`,
      `*${SYSTEM}:(OI)(CI)F`,
      `*${ADMINISTRATORS}:(OI)(CI)F`,
    ]);
  }
  // Node reports junctions as symbolic links; neither may redirect the build.
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${directory} must be a directory, not a link or junction`);
  const writers = untrustedWriters(readAcl(directory));
  if (writers.length)
    throw new Error(
      `${directory} can be modified by other accounts (${writers.join(", ")}). It holds only rebuildable build inputs: delete it and run the build again to recreate it privately.`,
    );
}
