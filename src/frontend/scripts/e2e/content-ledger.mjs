import { open, readFile } from "node:fs/promises";
import path from "node:path";

import { ensurePrivateDirectory } from "./run-support.mjs";

const CONTENT_LEDGER_SCHEMA_VERSION = 1;
const CONTENT_LEDGER_EVENTS = [
  "planned",
  "import_planned",
  "import_owned",
  "owned",
  "updated",
  "verified",
  "cleanup_started",
  "deleted",
  "cleanup_failed",
];

const CONTENT_KINDS = new Set([
  "gesture",
  "pose",
  "reaction",
  "particle_effect",
  "avatar_effect",
  "scene_effect",
  "avatar",
  "appearance",
  "idle_style",
  "sound_effect",
  "anima",
]);
const COMMON_KEYS = new Set([
  "schemaVersion",
  "event",
  "timestamp",
  "runId",
  "journeyKey",
  "kind",
  "entryName",
  "logicalKey",
]);
const EVENT_KEYS = {
  planned: new Set(),
  import_planned: new Set([
    "operationId",
    "stageId",
    "reviewDigest",
    "entryId",
    "packageEntries",
    "packageAnima",
  ]),
  import_owned: new Set([
    "operationId",
    "stageId",
    "reviewDigest",
    "entryId",
    "itemId",
    "revisionSha256",
    "relativeLocator",
    "packageEntries",
    "packageAnima",
    "animaDefinition",
    "relatedAvatarId",
    "relatedAvatarSha256",
  ]),
  owned: new Set(["itemId", "revisionSha256", "relativeLocator"]),
  updated: new Set([
    "itemId",
    "revisionSha256",
    "relativeLocator",
    "previousRevisionSha256",
  ]),
  verified: new Set([
    "itemId",
    "revisionSha256",
    "fileCount",
    "manifestSha256",
    "files",
  ]),
  cleanup_started: new Set(["itemId", "revisionSha256", "actor"]),
  deleted: new Set(["itemId", "revisionSha256", "outcome"]),
  cleanup_failed: new Set(["itemId", "revisionSha256", "code", "message"]),
};

function requiredString(value, label, maximum = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(
      `Content ledger ${label} must be a non-empty bounded string.`,
    );
  }
  return value;
}

function validateCommon(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Content ledger event must be an object.");
  }
  if (event.schemaVersion !== CONTENT_LEDGER_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported content ledger schema ${String(event.schemaVersion)}.`,
    );
  }
  if (!CONTENT_LEDGER_EVENTS.includes(event.event)) {
    throw new Error(`Unknown content ledger event ${String(event.event)}.`);
  }
  requiredString(event.timestamp, "timestamp", 64);
  if (Number.isNaN(Date.parse(event.timestamp))) {
    throw new Error("Content ledger timestamp must be ISO-8601 compatible.");
  }
  const runId = requiredString(event.runId, "runId", 80);
  if (!/^[a-z][a-z0-9-]*-\d{10}$/.test(runId)) {
    throw new Error("Content ledger runId has an invalid generated-ID shape.");
  }
  const journeyKey = requiredString(event.journeyKey, "journeyKey", 160);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(journeyKey)) {
    throw new Error("Content ledger journeyKey has an invalid shape.");
  }
  if (!CONTENT_KINDS.has(event.kind)) {
    throw new Error(
      `Content ledger kind ${String(event.kind)} is unsupported.`,
    );
  }
  requiredString(event.entryName, "entryName", 160);
  if (event.event === "import_planned") {
    if ("logicalKey" in event)
      throw new Error("Uncommitted imports cannot claim a Local logical key.");
  } else requiredString(event.logicalKey, "logicalKey", 256);
  if (event.event === "import_planned" || event.event === "import_owned") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.operationId ?? "")) {
      throw new Error("Package ownership requires an exact operation ID.");
    }
    if (
      !/^[0-9a-f]{32}$/.test(event.stageId ?? "") ||
      !/^[0-9a-f]{64}$/.test(event.reviewDigest ?? "")
    ) {
      throw new Error(
        "Package ownership requires its exact stage and review digest.",
      );
    }
    requiredString(event.entryId, "entryId", 128);
    if (event.packageEntries !== undefined) {
      if (
        !Array.isArray(event.packageEntries) ||
        !event.packageEntries.length ||
        event.packageEntries.length > 512
      )
        throw new Error(
          "Package ownership requires a bounded complete entry list.",
        );
      const ids = new Set();
      for (const entry of event.packageEntries) {
        if (
          !entry ||
          Object.keys(entry).sort().join() !== "entryId,kind,name,selected" ||
          !CONTENT_KINDS.has(entry.kind) ||
          entry.kind === "anima" ||
          typeof entry.selected !== "boolean"
        )
          throw new Error(
            "Package ownership contains an invalid reviewed entry.",
          );
        requiredString(entry.entryId, "package entry ID", 128);
        requiredString(entry.name, "package entry name", 160);
        if (ids.has(entry.entryId))
          throw new Error("Package ownership repeats an entry ID.");
        ids.add(entry.entryId);
      }
      if (event.kind === "anima") {
        if (
          event.entryId !== "anima" ||
          !event.packageAnima ||
          typeof event.packageAnima !== "object"
        )
          throw new Error(
            "Anima ownership requires its reviewed portable definition.",
          );
      } else if (
        !event.packageEntries.some(
          (entry) =>
            entry.entryId === event.entryId &&
            entry.kind === event.kind &&
            entry.name === event.entryName,
        )
      )
        throw new Error(
          "Package plan is outside its complete reviewed entry list.",
        );
    } else if (event.kind === "anima" || event.packageAnima !== undefined) {
      throw new Error("Anima ownership requires a whole-package plan.");
    }
  }

  const allowed = new Set([...COMMON_KEYS, ...EVENT_KEYS[event.event]]);
  const extra = Object.keys(event).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new Error(`Content ledger event contains unknown field ${extra[0]}.`);
  }
}

function validateIdentityFields(event) {
  if (event.event === "planned" || event.event === "import_planned") return;
  requiredString(event.itemId, "itemId", 256);
  if (!/^[0-9a-f]{64}$/.test(event.revisionSha256 ?? "")) {
    throw new Error(
      "Content ledger revisionSha256 must be a lowercase SHA-256.",
    );
  }
  if (
    event.event === "updated" &&
    !/^[0-9a-f]{64}$/.test(event.previousRevisionSha256 ?? "")
  ) {
    throw new Error(
      "Content ledger update requires its exact previous revision.",
    );
  }
  if (["owned", "import_owned", "updated"].includes(event.event)) {
    if (event.kind !== "anima")
      requiredString(event.relativeLocator, "relativeLocator", 512);
    else if (
      !event.animaDefinition ||
      typeof event.animaDefinition !== "object" ||
      typeof event.relatedAvatarId !== "string" ||
      !event.relatedAvatarId ||
      !/^[0-9a-f]{64}$/.test(event.relatedAvatarSha256 ?? "")
    )
      throw new Error(
        "Anima ownership requires its expected saved definition.",
      );
  } else if (event.event === "verified") {
    if (!Number.isSafeInteger(event.fileCount) || event.fileCount < 1) {
      throw new Error("Content ledger verified.fileCount must be positive.");
    }
    if (!/^[0-9a-f]{64}$/.test(event.manifestSha256 ?? "")) {
      throw new Error(
        "Content ledger manifestSha256 must be a lowercase SHA-256.",
      );
    }
    if (
      !Array.isArray(event.files) ||
      event.files.length !== event.fileCount ||
      event.files.length > 64
    ) {
      throw new Error(
        "Content ledger verified.files must match the bounded file count.",
      );
    }
    const paths = new Set();
    for (const file of event.files) {
      if (!file || typeof file !== "object" || Array.isArray(file)) {
        throw new Error(
          "Content ledger verified.files contains an invalid record.",
        );
      }
      const allowedKeys = new Set([
        "relativePath",
        "role",
        "mediaType",
        "sizeBytes",
        "sha256",
      ]);
      const extra = Object.keys(file).filter((key) => !allowedKeys.has(key));
      if (extra.length > 0) {
        throw new Error(
          `Content ledger verified file contains unknown field ${extra[0]}.`,
        );
      }
      const relativePath = requiredString(
        file.relativePath,
        "verified file relativePath",
        512,
      );
      if (
        relativePath.includes("\\") ||
        relativePath.includes("\0") ||
        relativePath.startsWith("/") ||
        relativePath
          .split("/")
          .some((part) => !part || part === "." || part === "..")
      ) {
        throw new Error(
          "Content ledger verified file relativePath must be a safe POSIX path.",
        );
      }
      if (paths.has(relativePath)) {
        throw new Error(
          "Content ledger verified.files contains a duplicate path.",
        );
      }
      paths.add(relativePath);
      requiredString(file.role, "verified file role", 128);
      requiredString(file.mediaType, "verified file mediaType", 128);
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
        throw new Error("Content ledger verified file sizeBytes is invalid.");
      }
      if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) {
        throw new Error("Content ledger verified file sha256 is invalid.");
      }
    }
  } else if (event.event === "cleanup_started") {
    if (!["fixture", "runner", "recovery"].includes(event.actor)) {
      throw new Error("Content ledger cleanup actor is unsupported.");
    }
  } else if (event.event === "deleted") {
    if (!["deleted", "already_missing"].includes(event.outcome)) {
      throw new Error("Content ledger delete outcome is unsupported.");
    }
  } else if (event.event === "cleanup_failed") {
    requiredString(event.code, "cleanup failure code", 80);
    requiredString(event.message, "cleanup failure message", 512);
  }
}

/** Validate one strict, versioned event without retaining arbitrary fields. */
function validateContentLedgerEvent(event) {
  validateCommon(event);
  validateIdentityFields(event);
  return structuredClone(event);
}

function assertSharedIdentity(previous, next) {
  for (const key of [
    "runId",
    "journeyKey",
    "kind",
    "entryName",
    "logicalKey",
  ]) {
    if (key === "logicalKey" && previous.event === "import_planned") continue;
    if (previous[key] !== next[key]) {
      throw new Error(`Content ledger transition changed ${key}.`);
    }
  }
  if (previous.itemId && next.itemId && previous.itemId !== next.itemId) {
    throw new Error("Content ledger transition changed itemId.");
  }
  if (
    previous.revisionSha256 &&
    next.revisionSha256 &&
    previous.revisionSha256 !== next.revisionSha256 &&
    next.event !== "updated"
  ) {
    throw new Error("Content ledger transition changed revisionSha256.");
  }
}

/** Enforce the ownership lifecycle; a generated name is never authority. */
function validateContentLedgerTransition(events, candidate) {
  const event = validateContentLedgerEvent(candidate);
  const related = events.filter(
    (value) => value.journeyKey === event.journeyKey,
  );
  const previous = related.at(-1) ?? null;
  if (!previous) {
    if (event.event !== "planned" && event.event !== "import_planned") {
      throw new Error("Content ledger lifecycle must begin with planned.");
    }
    if (events.some((value) => value.runId !== event.runId)) {
      throw new Error("Content ledger cannot mix run IDs.");
    }
    const operationPlans = event.operationId
      ? events.filter(
          (value) =>
            value.event === "import_planned" &&
            value.operationId === event.operationId,
        )
      : [];
    const first = operationPlans[0];
    // Earlier lines already passed this same check. Compare complete shared
    // facts once, while still checking every entry ID for duplication.
    if (
      first &&
      (!event.packageEntries ||
        operationPlans.some((value) => value.entryId === event.entryId) ||
        first.stageId !== event.stageId ||
        first.reviewDigest !== event.reviewDigest ||
        JSON.stringify(first.packageEntries) !==
          JSON.stringify(event.packageEntries) ||
        JSON.stringify(first.packageAnima) !==
          JSON.stringify(event.packageAnima))
    ) {
      throw new Error(
        "Package ownership cannot reuse an operation ID across journeys.",
      );
    }
    return event;
  }

  assertSharedIdentity(previous, event);
  if (previous.event === "import_planned" && event.event === "import_owned") {
    for (const key of [
      "operationId",
      "stageId",
      "reviewDigest",
      "entryId",
      "packageEntries",
      "packageAnima",
    ]) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(event[key]))
        throw new Error(`Content ledger transition changed ${key}.`);
    }
  }
  if (event.event === "updated") {
    const owned = related.findLast((value) =>
      ["owned", "import_owned", "updated"].includes(value.event),
    );
    if (
      !owned ||
      event.previousRevisionSha256 !== previous.revisionSha256 ||
      event.relativeLocator !== owned.relativeLocator
    ) {
      throw new Error(
        "Content ledger update must preserve its owned path and exact previous revision.",
      );
    }
  }
  const allowed = {
    planned: ["owned"],
    import_planned: ["import_owned"],
    import_owned: ["verified", "updated", "cleanup_started"],
    owned: ["verified", "updated", "cleanup_started"],
    updated: ["verified", "updated", "cleanup_started"],
    verified: ["updated", "cleanup_started"],
    cleanup_started: ["deleted", "cleanup_failed"],
    cleanup_failed: ["cleanup_started"],
    deleted: [],
  }[previous.event];
  if (!allowed.includes(event.event)) {
    throw new Error(
      `Invalid content ledger transition ${previous.event} -> ${event.event}.`,
    );
  }
  return event;
}

/** Read and validate every immutable JSON line and transition in order. */
export async function readContentLedger(ledgerPath) {
  let source;
  try {
    source = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const events = [];
  for (const [index, line] of source.split("\n").entries()) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Content ledger line ${index + 1} is invalid JSON.`);
    }
    events.push(validateContentLedgerTransition(events, parsed));
  }
  return events;
}

/** Append and fsync exactly one validated line; prior lines are never edited. */
export async function appendContentLedgerEvent(ledgerPath, input) {
  const events = await readContentLedger(ledgerPath);
  const event = validateContentLedgerTransition(events, {
    ...input,
    schemaVersion: CONTENT_LEDGER_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
  });
  await ensurePrivateDirectory(path.dirname(ledgerPath));
  const handle = await open(ledgerPath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`);
    await handle.sync();
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return event;
}

/** Return the last state and exact owned fact for every planned journey. */
export function summarizeContentLedger(events) {
  const byJourney = new Map();
  for (const event of events) {
    const current = byJourney.get(event.journeyKey) ?? {
      planned: null,
      owned: null,
      verified: null,
      last: null,
    };
    if (event.event === "planned" || event.event === "import_planned")
      current.planned = event;
    if (["owned", "import_owned", "updated"].includes(event.event)) {
      current.owned = event;
      current.verified = null;
    }
    if (event.event === "verified") current.verified = event;
    current.last = event;
    byJourney.set(event.journeyKey, current);
  }
  return [...byJourney.values()];
}

export function unresolvedOwnedContent(events) {
  return summarizeContentLedger(events).filter(
    (state) => state.owned && state.last?.event !== "deleted",
  );
}

/** Include unacknowledged import operations so runner recovery cannot silently skip them. */
export function unresolvedContentWork(events) {
  return summarizeContentLedger(events).filter((state) =>
    state.owned
      ? state.last?.event !== "deleted"
      : state.planned?.event === "import_planned",
  );
}
