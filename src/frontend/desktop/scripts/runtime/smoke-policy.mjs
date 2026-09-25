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

/** Accept current required-name evidence only for the exact candidate artifact. */
export function acceptsRequiredNameSmoke(
  smoke,
  network,
  { dmgSha256, runtimeBuildId },
) {
  return (
    smoke?.passed === true &&
    smoke.setup === "name" &&
    smoke.checks?.required_private_name === true &&
    smoke.checks?.empty_name_rejected === true &&
    smoke.checks?.blank_name_rejected === true &&
    smoke.checks?.adult_confirmation_required === true &&
    smoke.checks?.first_anima_chat === true &&
    smoke.checks?.temporary_provider_removed === true &&
    smoke.checks?.temporary_provider_removal_persists === true &&
    !smoke.cleanup_required &&
    smoke.dmg_sha256 === dmgSha256 &&
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

/** This is an explicit human attestation bound to the exact signed DMG, not a test override. */
export function validateManualAcceptance(value, dmgSha256, version) {
  if (
    value?.schema !== "animama-macos-acceptance/1" ||
    value.app_version !== version ||
    value.dmg_sha256 !== dmgSha256 ||
    typeof value.reviewed_by !== "string" ||
    !/^[^\x00-\x1f\x7f]{1,100}$/u.test(value.reviewed_by) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.reviewed_on ?? "") ||
    value.reviewed_on > new Date().toISOString().slice(0, 10) ||
    !manualMacChecks.every((name) => value.checks?.[name] === true) ||
    !olderStableVersion(value.prior_signed_version, version)
  )
    throw new Error(
      "Manual native/update acceptance is missing or does not match this exact DMG. Complete the release checklist; do not manufacture an approval.",
    );
  return {
    schema: value.schema,
    app_version: version,
    dmg_sha256: dmgSha256,
    reviewed_by: value.reviewed_by,
    reviewed_on: value.reviewed_on,
    prior_signed_version: value.prior_signed_version,
    checks: Object.fromEntries(manualMacChecks.map((name) => [name, true])),
  };
}
