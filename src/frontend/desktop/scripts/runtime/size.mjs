import { writeFileSync } from "node:fs";
import path from "node:path";
import { readJson, sourceRoot, writeJson } from "./common.mjs";

const versionTuple = (value) => {
  if (!/^\d+\.\d+\.\d+$/u.test(value))
    throw new Error("Size exceptions require an exact app version");
  return value.split(".").map(Number);
};
function versionAfter(left, right) {
  const a = versionTuple(left);
  const b = versionTuple(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Exceptions are auditable owner decisions, never automatically granted caps. */
export function checkSizes(
  report,
  budgets,
  baseline,
  exceptions,
  approvalRecord,
  today = new Date().toISOString().slice(0, 10),
) {
  if (
    approvalRecord?.schema !== "animama-size-approvals/1" ||
    !Array.isArray(approvalRecord.approvals)
  ) {
    throw new Error("Size approval record must use animama-size-approvals/1");
  }
  const approvalFields = [
    "id",
    "component",
    "target",
    "approved_byte_ceiling",
    "rationale",
    "author",
    "approval_date",
    "last_applicable_app_version",
  ];
  const failures = [];
  const accepted = [];
  const ceiling = (component, bytes, limit) => {
    if (bytes <= limit) return;
    const approval = exceptions.exceptions.find(
      (item) =>
        item.component === component &&
        item.target === report.target &&
        Number.isSafeInteger(item.approved_byte_ceiling) &&
        bytes <= item.approved_byte_ceiling &&
        typeof item.id === "string" &&
        typeof item.rationale === "string" &&
        item.rationale.trim() &&
        typeof item.author === "string" &&
        item.author.trim() &&
        /^\d{4}-\d{2}-\d{2}$/u.test(item.approval_date) &&
        item.approval_date <= today &&
        !versionAfter(report.app_version, item.last_applicable_app_version) &&
        approvalRecord.approvals.some(
          (decision) =>
            decision?.decision === "approved" &&
            approvalFields.every((field) => decision[field] === item[field]),
        ),
    );
    if (approval) accepted.push(approval.id);
    else failures.push(`${component}: ${bytes} bytes exceeds ${limit}`);
  };
  ceiling(
    "core.installed",
    report.installed_bytes,
    budgets.core.installed_bytes,
  );
  ceiling("core.download", report.download_bytes, budgets.core.download_bytes);
  const previous = baseline.targets[report.target];
  if (baseline.app_version !== null && !previous)
    failures.push("Released baseline is missing this target");
  if (previous) {
    for (const component of report.components) {
      const old = previous.components[component.name];
      if (!Number.isSafeInteger(old) || old <= 0)
        failures.push(`Released baseline is missing ${component.name}`);
      else
        ceiling(
          component.name,
          component.installed_bytes,
          Math.floor(old * (1 + budgets.regression_percent / 100)),
        );
    }
  }
  for (const [id, pack] of Object.entries(report.packs)) {
    const budget = budgets.packs[id];
    if (!budget) throw new Error(`Unknown pack budget: ${id}`);
    if (pack.installed_bytes !== null)
      ceiling(`${id}.installed`, pack.installed_bytes, budget.installed_bytes);
    if (pack.download_bytes !== null && budget.download_bytes !== null)
      ceiling(`${id}.download`, pack.download_bytes, budget.download_bytes);
  }
  return {
    failures,
    accepted_exceptions: [...new Set(accepted)],
    regression_baseline: baseline.app_version ?? "not-yet-released",
  };
}

export function validateSizeReport(report) {
  return checkSizes(
    report,
    readJson(path.join(sourceRoot, "size-budgets.json")),
    readJson(path.join(sourceRoot, "size-baseline.json")),
    readJson(path.join(sourceRoot, "size-exceptions.json")),
    readJson(path.join(sourceRoot, "size-approvals.json")),
  );
}

export function saveSizeReport(output, report) {
  report.validation = validateSizeReport(report);
  writeJson(path.join(output, "size-report.json"), report);
  const lines = [
    "# Desktop runtime feasibility size report",
    "",
    `Target: ${report.target}; app: ${report.app_version}.`,
    "",
    "These are exact staged payload/archive bytes, not a signed DMG or update ZIP. Signing and installer overhead require separate binary release measurements.",
    "",
    "| Component | Installed bytes | MiB |",
    "| --- | ---: | ---: |",
    ...report.components.map(
      (c) =>
        `| ${c.name} | ${c.installed_bytes} | ${(c.installed_bytes / 1048576).toFixed(2)} |`,
    ),
    "",
    `Core installed: ${report.installed_bytes} / 1610612736 bytes.`,
    `Core download (feasibility archive): ${report.download_bytes} / 786432000 bytes.`,
    "",
    `Regression baseline: ${report.validation.regression_baseline}.`,
    "",
    ...Object.entries(report.packs).map(
      ([name, pack]) =>
        `- ${name}: installed ${pack.installed_bytes ?? "not built"}; compressed ${pack.download_bytes ?? "not built"} bytes.`,
    ),
    "",
    ...report.validation.failures.map((failure) => `FAIL: ${failure}`),
    "",
  ];
  writeFileSync(path.join(output, "size-report.md"), lines.join("\n"));
  return report.validation;
}
