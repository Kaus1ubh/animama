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
        { failOnStatusCode: false },
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

    async deleteItem(itemId, revisionSha256) {
      const exact = exactItemId(itemId);
      const revision = exactRevision(revisionSha256);
      const response = await apiContext.delete(
        `/v1/content/items/${encodeURIComponent(exact)}`,
        {
          failOnStatusCode: false,
          params: { expected_revision: revision },
        },
      );
      return { status: response.status() };
    },

    async close() {
      await apiContext.dispose();
    },
  };
}
