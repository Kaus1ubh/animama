import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { desktopRoot, readJson, sha256 } from "./common.mjs";

function link(label, file) {
  return `[${label}](${file})`;
}

/** Render only measured facts; source/legal reasoning lives in the tracked review guide. */
export function renderRedistributionReview({
  target,
  manifest,
  inventory,
  sizes,
  packReport,
  inventorySha256,
}) {
  const noAssertion = inventory.records.filter(
    (record) => record.license === "NOASSERTION",
  );
  const rows = packReport.reports.map((report) => {
    const measured = sizes.packs[report.id];
    return `| \`${report.id}\` | \`${report.state}\` | ${report.inventory_sha256 ? `\`${report.inventory_sha256}\`` : "Not required"} | ${measured?.installed_bytes ?? "—"} | ${measured?.download_bytes ?? "—"} |`;
  });
  const output = target.output;
  return [
    "# Desktop redistribution review",
    "",
    "**Unapproved local evidence packet. It does not authorize signing, publication, or a repository visibility change.**",
    "",
    "The tracked source/provenance analysis is in " +
      link(
        "Desktop redistribution review",
        path.join(desktopRoot, "../../../docs/frontend/desktop/redistribution-review.md"),
      ) +
      ". Review it together with the exact generated files below.",
    "",
    "## Core evidence",
    "",
    `- Build ID: \`${manifest.build_id}\``,
    `- Runtime files: ${manifest.files.length}`,
    `- Installed bytes: ${sizes.installed_bytes}`,
    `- Feasibility-download bytes: ${sizes.download_bytes}`,
    `- Pending records: ${inventory.pending_review.length}`,
    `- \`NOASSERTION\` records: ${noAssertion.length}`,
    `- License-inventory SHA-256: \`${inventorySha256}\``,
    "",
    link(
      "Core inventory",
      path.join(target.runtime, "licenses/inventory.json"),
    ) +
      " · " +
      link(
        "Third-party notices",
        path.join(target.runtime, "licenses/THIRD_PARTY_NOTICES.txt"),
      ) +
      " · " +
      link("Native audit", path.join(output, "audit-report.json")),
    "",
    "## Feature packs",
    "",
    "| Pack | State | Inventory SHA-256 | Installed bytes | Download bytes |",
    "| --- | --- | --- | ---: | ---: |",
    ...rows,
    "",
    "Only packs marked `redistribution_review_required` need initial-release review. Deferred packs must remain absent from the catalog and release artifacts.",
    "",
    "## Next action",
    "",
    "Inspect the tracked source review, every pending record and its notice text, and the active pack inventory. Only then may the owner copy these exact hashes into the release approval fields. Any source, notice, policy, or staged-byte change requires a fresh stage and a new review.",
    "",
  ].join("\n");
}

export function writeRedistributionReview(target) {
  const manifest = readJson(path.join(target.runtime, "manifest.json"));
  const inventoryPath = path.join(target.runtime, "licenses/inventory.json");
  const inventory = readJson(inventoryPath);
  const sizes = readJson(path.join(target.output, "size-report.json"));
  const packReport = readJson(
    path.join(target.output, "feature-packs/pack-build-report.json"),
  );
  const directory = path.join(desktopRoot, "release/review");
  mkdirSync(directory, { recursive: true });
  const output = path.join(directory, "redistribution-review.md");
  writeFileSync(
    output,
    renderRedistributionReview({
      target,
      manifest,
      inventory,
      sizes,
      packReport,
      inventorySha256: sha256(inventoryPath),
    }),
  );
  return output;
}
