/** Only categorical network evidence is retained; URLs can contain identities, capabilities or presigned credentials. */
export function classifySmokeRequest(rawUrl, gateway) {
  const url = new URL(rawUrl);
  if (
    ["blob:", "data:", "devtools:"].includes(url.protocol) ||
    url.href === "about:blank"
  )
    return {
      origin: "in-process",
      family: "renderer-resource",
      forbidden: false,
    };
  const storage =
    /(?:r2\.cloudflarestorage\.com|amazonaws\.com|(?:^|\.)minio\b)/iu.test(
      url.hostname,
    ) ||
    [...url.searchParams.keys()].some((key) =>
      /^(?:x-amz-|x-goog-|signature$)/iu.test(key),
    );
  const local = url.origin === gateway;
  const typed =
    /^\/v1\/(?:animas\/[^/]+\/runtime\/revisions\/[^/]+\/files\/|content\/previews\/[^/]+\/revisions\/[^/]+\/files\/|content\/files\/)/u.test(
      url.pathname,
    );
  return {
    origin: storage ? "object-storage" : local ? "gateway" : "external",
    family: typed
      ? "typed-byte"
      : url.pathname.startsWith("/v1/")
        ? "api"
        : "renderer-resource",
    forbidden: storage || !local,
  };
}

export const manualMacChecks = [
  "avatar_animation",
  "pocket_tts",
  "microphone",
  "pip",
  "quick_chat",
  "offline_dictation",
  "document_processing",
  "expanded_content",
  "pack_interruption",
  "update_preserves_local_state",
  "migration_snapshot_recovery",
  "native_network",
];

export const manualWindowsChecks = [
  "avatar_animation",
  "pocket_tts",
  "microphone",
  "pip",
  "quick_chat",
  "global_shortcuts",
  "offline_dictation",
  "smartscreen_download",
  "installer_upgrade_uninstall_reinstall",
  "update_preserves_local_state",
  "migration_snapshot_recovery",
  "native_network",
];

/** Checks that only a build with an active feature pack can exercise. */
const PACK_CHECKS = new Set([
  "document_processing",
  "expanded_content",
  "pack_interruption",
]);

/** What each target's smoke report and human acceptance are bound to. */
const ACCEPTANCE = {
  "darwin-arm64": {
    schema: "animama-macos-acceptance/1",
    artifact: "dmg_sha256",
    label: "DMG",
    checks: manualMacChecks,
  },
  "win32-x64": {
    schema: "animama-windows-acceptance/1",
    artifact: "installer_sha256",
    label: "installer",
    checks: manualWindowsChecks,
  },
};

/**
 * The hardening checks of the installed-artifact smoke: the exact app's fuse
 * wire, publisher signature, sealed update policy and refused debugging
 * switches, and the journey copy's wire, unavailable updates and untouched
 * canonical profile.
 */
export const hardeningSmokeChecks = [
  "exact_fuse_wire",
  "publisher_signature",
  "sealed_update_policy",
  "debugging_switches_refused",
  "copy_fuse_wire",
  "copy_updates_unavailable",
  "canonical_profile_untouched",
];

/** Accept current required-name evidence only for the exact candidate artifact. */
export function acceptsRequiredNameSmoke(
  smoke,
  network,
  { artifactSha256, runtimeBuildId, target = "darwin-arm64" },
) {
  return (
    smoke?.passed === true &&
    smoke.setup === "name" &&
    hardeningSmokeChecks.every((check) => smoke.checks?.[check] === true) &&
    smoke.checks?.required_private_name === true &&
    smoke.checks?.empty_name_rejected === true &&
    smoke.checks?.blank_name_rejected === true &&
    smoke.checks?.adult_confirmation_required === true &&
    smoke.checks?.setup_steps === true &&
    smoke.checks?.first_anima_chat === true &&
    smoke.checks?.temporary_provider_removed === true &&
    smoke.checks?.temporary_provider_removal_persists === true &&
    !smoke.cleanup_required &&
    smoke[ACCEPTANCE[target].artifact] === artifactSha256 &&
    smoke.runtime_build_id === runtimeBuildId &&
    network?.violations === 0
  );
}

/** Upgrade evidence must start from an older stable version, never a downgrade. */
function olderStableVersion(previous, current) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
  if (!stable.test(previous ?? "") || !stable.test(current)) return false;
  const left = previous.split(".").map(BigInt);
  const right = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i];
  }
  return false;
}

/**
 * This is an explicit human attestation bound to the exact signed artifact, not
 * a test override. A build without active packs (`packs: false`) skips the
 * pack checks it cannot exercise.
 */
export function validateManualAcceptance(
  value,
  artifactSha256,
  version,
  target = "darwin-arm64",
  { packs = true } = {},
) {
  const spec = ACCEPTANCE[target];
  const checks = packs
    ? spec.checks
    : spec.checks.filter((name) => !PACK_CHECKS.has(name));
  if (
    value?.schema !== spec.schema ||
    value.app_version !== version ||
    value[spec.artifact] !== artifactSha256 ||
    typeof value.reviewed_by !== "string" ||
    !/^[^\x00-\x1f\x7f]{1,100}$/u.test(value.reviewed_by) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.reviewed_on ?? "") ||
    value.reviewed_on > new Date().toISOString().slice(0, 10) ||
    !checks.every((name) => value.checks?.[name] === true) ||
    !olderStableVersion(value.prior_signed_version, version)
  )
    throw new Error(
      `Manual native/update acceptance is missing or does not match this exact ${spec.label}. Complete the release checklist; do not manufacture an approval.`,
    );
  return {
    schema: value.schema,
    app_version: version,
    [spec.artifact]: artifactSha256,
    reviewed_by: value.reviewed_by,
    reviewed_on: value.reviewed_on,
    prior_signed_version: value.prior_signed_version,
    checks: Object.fromEntries(checks.map((name) => [name, true])),
  };
}
