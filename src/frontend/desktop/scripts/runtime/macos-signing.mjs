import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { run } from "./common.mjs";

const NOTARY_SUBMISSION_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function notaryProfile() {
  const profile = process.env.ANIMAMA_MACOS_NOTARY_PROFILE;
  if (!profile || !/^[A-Za-z0-9_.-]{1,100}$/u.test(profile))
    throw new Error(
      "Set ANIMAMA_MACOS_NOTARY_PROFILE to the release Keychain profile.",
    );
  return profile;
}

function acceptedNotarization(result) {
  if (result.status !== "Accepted")
    throw new Error(
      "Apple notarization was not accepted. Review the private CI notary log before retrying.",
    );
  return { id: result.id, status: "Accepted" };
}

/** Apple request identifiers are UUIDs; reject all other command-line input. */
export function assertNotarizationSubmissionId(submissionId) {
  if (
    typeof submissionId !== "string" ||
    !NOTARY_SUBMISSION_ID.test(submissionId)
  )
    throw new Error("Expected an Apple notarization submission UUID");
  return submissionId;
}

/** File extensions miss Python executables, framework binaries and native addons. */
export function isMachO(file) {
  const fd = openSync(file, "r");
  const bytes = Buffer.alloc(4);
  try {
    readSync(fd, bytes, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  return [
    "feedface",
    "feedfacf",
    "cefaedfe",
    "cffaedfe",
    "cafebabe",
    "bebafeca",
    "cafebabf",
    "bfbafeca",
  ].includes(bytes.toString("hex"));
}

/** Notary credentials are an existing Keychain profile; no password is read or printed here. */
export function notarize(file) {
  const profile = notaryProfile();
  const result = JSON.parse(
    run(
      "/usr/bin/xcrun",
      [
        "notarytool",
        "submit",
        file,
        "--keychain-profile",
        profile,
        "--wait",
        "--timeout",
        "60m",
        "--output-format",
        "json",
      ],
      { capture: true },
    ),
  );
  return acceptedNotarization(result);
}

/** Resume one known Apple request; never create a second upload after a bounded wait. */
export function waitForNotarization(submissionId, timeout = "60m") {
  assertNotarizationSubmissionId(submissionId);
  if (!/^(?:[1-9]|[1-5]\d|60)m$/u.test(timeout))
    throw new Error("Notarization wait must be between 1m and 60m");
  const result = JSON.parse(
    run(
      "/usr/bin/xcrun",
      [
        "notarytool",
        "wait",
        submissionId,
        "--keychain-profile",
        notaryProfile(),
        "--timeout",
        timeout,
        "--output-format",
        "json",
      ],
      { capture: true },
    ),
  );
  return acceptedNotarization(result);
}

/** Validate the sealed app before a pending notarization request has a ticket. */
export function verifyAppCodeSignature(
  app,
  team,
  identifier = "com.animama.desktop",
) {
  run(
    "/usr/bin/codesign",
    [
      "--verify",
      "--deep",
      "--strict",
      "-R",
      `=anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${team}"`,
      app,
    ],
    { capture: true },
  );
}

export function verifySignedApp(app, team, identifier = "com.animama.desktop") {
  verifyAppCodeSignature(app, team, identifier);
  run("/usr/sbin/spctl", ["--assess", "--type", "execute", app], {
    capture: true,
  });
  run("/usr/bin/xcrun", ["stapler", "validate", app], { capture: true });
}

/** Ordered leaves then nested bundles. Framework aliases are validated by componentInventory, not traversed. */
export function nestedCode(app, inventory) {
  const native = inventory
    .filter(
      (entry) => entry.type === "file" && isMachO(path.join(app, entry.path)),
    )
    .map((entry) => entry.path);
  const bundles = new Set();
  for (const file of native) {
    let cursor = path.posix.dirname(file);
    while (cursor !== ".") {
      if (/\.(?:app|framework|xpc|bundle)$/u.test(cursor)) bundles.add(cursor);
      cursor = path.posix.dirname(cursor);
    }
  }
  const deepest = (a, b) =>
    b.split("/").length - a.split("/").length || a.localeCompare(b);
  return { native: native.sort(deepest), bundles: [...bundles].sort(deepest) };
}
