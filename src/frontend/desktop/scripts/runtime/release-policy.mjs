import path from "node:path";
import { desktopRoot, readJson, sha256, sourceRoot } from "./common.mjs";

const HASH = /^[a-f0-9]{64}$/u;
const PART = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;
const releasePolicyPath = path.join(sourceRoot, "release-policy.json");

/** Pin candidate URLs and publisher inputs offline; visibility is checked only at publication. */
export function validateReleasePolicy(
  policy,
  packs,
  version,
  { requireReview = true } = {},
) {
  if (
    policy?.schema !== "animama-release-policy/1" ||
    policy.channel !== "stable" ||
    Object.keys(policy).sort().join(",") !==
      "channel,distribution_basis,github,redistribution_review,schema" ||
    !policy.distribution_basis ||
    Object.keys(policy.distribution_basis).sort().join(",") !==
      "commercial,pocket_tts_onnx_license" ||
    policy.distribution_basis.commercial !== false ||
    policy.distribution_basis.pocket_tts_onnx_license !== "CC-BY-NC-4.0" ||
    !policy.github ||
    Object.keys(policy.github).sort().join(",") !== "owner,repo" ||
    typeof policy.github.owner !== "string" ||
    typeof policy.github.repo !== "string" ||
    !PART.test(policy.github.owner) ||
    !PART.test(policy.github.repo)
  )
    throw new Error(
      "Set the intended installer/update repository and noncommercial installer/update policy in runtime/release-policy.json; the current PocketTTS exports require CC-BY-NC-4.0 treatment, candidates may remain private, and embedded GitHub tokens are not supported.",
    );
  const publisher = packs?.macos;
  if (
    !/^[A-Z0-9]{10}$/u.test(publisher?.team_id ?? "") ||
    typeof publisher?.signing_identity !== "string" ||
    !publisher.signing_identity.startsWith("Developer ID Application:") ||
    !publisher.signing_identity.endsWith(`(${publisher.team_id})`) ||
    !publisher.designated_requirement
  )
    throw new Error(
      "Configure the reviewed macOS publisher in runtime/feature-pack-releases.json; ad-hoc signing is not a release.",
    );
  if (
    !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/u.test(version) ||
    packs.release_base_url !==
      `https://github.com/${policy.github.owner}/${policy.github.repo}/releases/download/v${version}`
  )
    throw new Error(
      "Core updates and feature packs must use the same intended repository and exact stable release tag.",
    );
  if (requireReview) {
    const review = policy.redistribution_review;
    if (
      !review ||
      !HASH.test(review.inventory_sha256 ?? "") ||
      typeof review.reviewed_by !== "string" ||
      !/^[^\x00-\x1f\x7f]{1,100}$/u.test(review.reviewed_by) ||
      typeof review.reviewed_on !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(review.reviewed_on) ||
      review.reviewed_on > new Date().toISOString().slice(0, 10)
    )
      throw new Error(
        "A human redistribution review of the exact staged licenses/inventory.json is required. Do not invent or auto-approve this receipt.",
      );
  }
  const packReleases = packs.packs;
  if (
    !packReleases ||
    Object.keys(packReleases).sort().join(",") !==
      "document-processing,expanded-included-content,parakeet-stt" ||
    Object.values(packReleases).some(
      (pack) => !["active", "deferred"].includes(pack?.release_status),
    )
  )
    throw new Error(
      "Every supported feature pack requires an explicit active or deferred release status.",
    );
  return {
    policy,
    publisher,
    version,
    packReleases,
    activePackIds: Object.keys(packReleases)
      .filter((id) => packReleases[id].release_status === "active")
      .sort(),
    updatePolicy: {
      schema: "animama-update-policy/1",
      github: policy.github,
      channel: "stable",
      team_id: publisher.team_id,
    },
  };
}

export function loadReleasePolicy(options) {
  return validateReleasePolicy(
    readJson(releasePolicyPath),
    readJson(path.join(sourceRoot, "feature-pack-releases.json")),
    readJson(path.join(desktopRoot, "package.json")).version,
    options,
  );
}

/** Publication alone requires anonymous access; credentials must never make this check pass. */
export async function isPublicReleaseRepository({ owner, repo }) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    return response.ok && (await response.json()).private === false;
  } catch {
    // Network/JSON/redirect failures cannot grant permission to publish.
    return false;
  }
}

/** A safe, inert policy keeps unsigned development stages usable without enabling production updates. */
export function stagedUpdatePolicy() {
  const policy = readJson(releasePolicyPath);
  if (policy.github === null)
    return {
      schema: "animama-update-policy/1",
      github: null,
      channel: "stable",
      team_id: null,
    };
  return loadReleasePolicy({ requireReview: false }).updatePolicy;
}

export function verifyRedistributionReview(runtime, release) {
  if (
    sha256(path.join(runtime, "licenses/inventory.json")) !==
    release.policy.redistribution_review.inventory_sha256
  )
    throw new Error(
      "Redistribution review does not match the exact staged inventory. Review the changed dependencies/assets before releasing.",
    );
}
