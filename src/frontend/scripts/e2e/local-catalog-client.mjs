import { createHash } from "node:crypto";

import { request as playwrightRequest } from "playwright";

import { isLoopbackUrl } from "./run-support.mjs";

function exactItemId(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    value.includes("/")
  ) {
    throw new Error("Catalog operation requires one exact opaque item ID.");
  }
  return value;
}

function exactRevision(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Catalog deletion requires one exact lowercase revision.");
  }
  return value;
}

function exactAnimaId(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    value.includes("/")
  ) {
    throw new Error("Loadout read requires one exact opaque Anima ID.");
  }
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hash a JSON-compatible read model without retaining transport ordering. */
export function stableJsonSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Hash a portable Anima definition. Idle and Reaction pool members form sets
 * listed in catalog item ID order, and an import gives every member a new
 * item ID, so each pool is hashed in sorted order.
 */
export function animaDefinitionSha256(anima) {
  if (!anima?.idle) return stableJsonSha256(anima);
  const members = (ids) => [...ids].sort();
  const sortedCells = (cells) =>
    Object.fromEntries(
      Object.entries(cells).map(([emotion, levels]) => [
        emotion,
        Object.fromEntries(
          Object.entries(levels).map(([level, ids]) => [level, members(ids)]),
        ),
      ]),
    );
  return stableJsonSha256({
    ...anima,
    ...(anima.reactions ? { reactions: sortedCells(anima.reactions) } : {}),
    idle: {
      default: members(anima.idle.default),
      cells: sortedCells(anima.idle.cells),
    },
  });
}

/** Keep only stable neutral Local identities for before/after smoke proof. */
export function localCatalogSnapshot(catalog) {
  if (!catalog || !Array.isArray(catalog.items)) {
    throw new Error("Neutral content catalog response is malformed.");
  }
  const items = catalog.items
    .filter((item) => item?.source === "local")
    .map((item) => ({
      itemId: String(item.item_id ?? ""),
      kind: String(item.kind ?? ""),
      logicalKey:
        typeof item.logical_key === "string" ? item.logical_key : null,
      displayName: String(item.display_name ?? item.name ?? ""),
      revisionSha256:
        typeof item.revision_sha256 === "string" ? item.revision_sha256 : null,
      relativeLocator: String(item.relative_locator ?? ""),
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  return {
    itemCount: items.length,
    sha256: stableJsonSha256(items),
    items,
  };
}

/** Same-origin accountless catalog operations; no owner headers or credentials. */
export async function createLocalCatalogClient({
  apiUrl,
  requestFactory = (options) => playwrightRequest.newContext(options),
}) {
  if (!isLoopbackUrl(apiUrl) || new URL(apiUrl).origin !== apiUrl) {
    throw new Error("Local catalog utilities require a bare loopback origin.");
  }
  const apiContext = await requestFactory({
    baseURL: apiUrl,
    extraHTTPHeaders: {
      accept: "application/json",
      Origin: apiUrl,
      "Sec-Fetch-Site": "same-origin",
      "X-Animama-CSRF": "1",
    },
  });

  return {
    async listCatalog() {
      const response = await apiContext.get("/v1/content/catalog", {
        failOnStatusCode: false,
      });
      if (!response.ok()) {
        throw new Error(
          `Neutral catalog read returned HTTP ${response.status()}.`,
        );
      }
      const body = await response.json();
      if (!body || !Array.isArray(body.items)) {
        throw new Error("Neutral catalog read returned a malformed body.");
      }
      return body;
    },

    async getItem(itemId, { allowMissing = false } = {}) {
      const exact = exactItemId(itemId);
      const response = await apiContext.get(
        `/v1/content/items/${encodeURIComponent(exact)}`,
        // Reads can wait behind a complete-package catalog reconciliation.
        { failOnStatusCode: false, timeout: 60_000 },
      );
      if (response.status() === 404 && allowMissing) return null;
      if (!response.ok()) {
        throw new Error(
          `Exact catalog item read returned HTTP ${response.status()}.`,
        );
      }
      return response.json();
    },

    async getAnimaLoadout(animaId) {
      const exact = exactAnimaId(animaId);
      const response = await apiContext.get(
        `/v1/animas/${encodeURIComponent(exact)}/loadout`,
        { failOnStatusCode: false },
      );
      if (!response.ok()) {
        throw new Error(
          `Neutral Anima loadout read returned HTTP ${response.status()}.`,
        );
      }
      const body = await response.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error(
          "Neutral Anima loadout read returned a malformed body.",
        );
      }
      return body;
    },

    async getPackageOperation(operationId) {
      if (
        typeof operationId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationId)
      ) {
        throw new Error(
          "Package receipt lookup requires one exact operation ID.",
        );
      }
      const response = await apiContext.get(
        `/v1/content/package-operations/${encodeURIComponent(operationId)}`,
        { failOnStatusCode: false },
      );
      if (!response.ok())
        throw new Error(
          `Package operation read returned HTTP ${response.status()}.`,
        );
      return response.json();
    },

    async getAnima(animaId, { allowMissing = false } = {}) {
      const exact = exactAnimaId(animaId);
      const response = await apiContext.get(
        `/v1/animas/${encodeURIComponent(exact)}`,
        { failOnStatusCode: false },
      );
      if (response.status() === 404 && allowMissing) return null;
      if (!response.ok())
        throw new Error(`Exact Anima read returned HTTP ${response.status()}.`);
      return response.json();
    },

    async getAnimaExport(animaId) {
      const response = await apiContext.post(
        "/v1/content/package-exports:summary",
        {
          failOnStatusCode: false,
          data: { anima_id: exactAnimaId(animaId) },
        },
      );
      if (!response.ok())
        throw new Error(`Saved Anima read returned HTTP ${response.status()}.`);
      return response.json();
    },

    async deleteAnima(animaId) {
      const response = await apiContext.delete(
        `/v1/animas/${encodeURIComponent(exactAnimaId(animaId))}`,
        {
          failOnStatusCode: false,
        },
      );
      return { status: response.status() };
    },

    async getAvatar(avatarId, { allowMissing = false } = {}) {
      const response = await apiContext.get(
        `/v1/avatars/${encodeURIComponent(exactItemId(avatarId))}`,
        { failOnStatusCode: false },
      );
      if (response.status() === 404 && allowMissing) return null;
      if (!response.ok())
        throw new Error(
          `Exact Avatar read returned HTTP ${response.status()}.`,
        );
      return response.json();
    },

    async deleteAvatar(avatarId) {
      const response = await apiContext.delete(
        `/v1/avatars/${encodeURIComponent(exactItemId(avatarId))}`,
        { failOnStatusCode: false },
      );
      return { status: response.status() };
    },

    async deleteItem(itemId, revisionSha256) {
      const exact = exactItemId(itemId);
      const revision = exactRevision(revisionSha256);
      const response = await apiContext.delete(
        `/v1/content/items/${encodeURIComponent(exact)}`,
        {
          failOnStatusCode: false,
          params: { expected_revision: revision },
          // Large imported closures rescan Local content before deletion commits.
          timeout: 60_000,
        },
      );
      return { status: response.status() };
    },

    /** Discard one package stage; the caller interprets its status and stable code. */
    async discardPackageStage(kind, stageId) {
      if (
        (kind !== "import" && kind !== "export") ||
        typeof stageId !== "string" ||
        !/^[0-9a-f]{32}$/.test(stageId)
      ) {
        throw new Error(
          "Package stage release requires one exact package stage kind and ID.",
        );
      }
      const response = await apiContext.delete(
        `/v1/content/package-${kind}s/${stageId}`,
        { failOnStatusCode: false },
      );
      if (response.ok()) return { status: response.status(), code: null };
      const body = await response.json().catch(() => null);
      const code = body?.detail?.code;
      return {
        status: response.status(),
        code: typeof code === "string" ? code : null,
      };
    },

    async close() {
      await apiContext.dispose();
    },
  };
}
