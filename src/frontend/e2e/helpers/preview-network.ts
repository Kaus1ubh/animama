import { createHash } from "node:crypto";

import type { Page, Request, Response, Route } from "playwright/test";

import type { EvidenceAttachment } from "../fixtures/animama";

type SafePreviewFile = {
  filename: string;
  logicalPath: string | null;
  mediaType: string;
  role: string;
  sizeBytes: number;
};

export type PreviewNetworkSnapshot = {
  endpointFamily: string;
  responseStatus: number;
  selected: {
    kind: string;
    logicalKey: string | null;
    name: string;
    runtimeId: string;
  };
  registeredRuntimeIds: string[];
  registeredResources: SafePreviewFile[];
  successfulProtectedResources: Array<SafePreviewFile & { status: number }>;
};

const PREVIEW_PATH =
  /^\/v1\/(poses|gestures|reactions|pose-clips|particle-effects|avatar-effects|scene-effects)\/[^/]+:preview$/;
const PROTECTED_FILE_PATH =
  /^\/v1\/content\/previews\/[^/]+\/revisions\/[^/]+\/files\/[^/]+$/;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function logicalLeaf(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.split(":").at(-1)?.trim() ?? "";
}

function runtimeId(item: Record<string, unknown>): string {
  const kind = String(item.kind ?? "");
  if (kind === "gesture") return String(item.semantic_key ?? "");
  if (kind === "reaction") {
    return (
      logicalLeaf(item.logical_key) ||
      `${String(item.emotion ?? "")}-${String(item.intensity ?? "")}`
    );
  }
  if (kind === "pose") return String(item.pose_id ?? "");
  if (kind === "pose_clip") return String(item.clip_id ?? "");
  return logicalLeaf(item.logical_key ?? item.item_id);
}

function safeFile(value: unknown): SafePreviewFile | null {
  const file = object(value);
  const filename = String(file.filename ?? "").trim();
  const role = String(file.role ?? "").trim();
  const mediaType = String(file.media_type ?? "").trim();
  const sizeBytes = Number(file.size_bytes ?? 0);
  if (!filename || !role || !mediaType || !Number.isFinite(sizeBytes)) {
    return null;
  }
  return {
    filename,
    logicalPath:
      typeof file.logical_path === "string" ? file.logical_path : null,
    mediaType,
    role,
    sizeBytes,
  };
}

function sanitizedPreview(
  response: Response,
  body: unknown,
): {
  snapshot: PreviewNetworkSnapshot;
  protectedFiles: Map<string, SafePreviewFile>;
} {
  const root = object(body);
  const item = object(root.item);
  const selectedRuntimeId = runtimeId(item);
  if (!selectedRuntimeId) {
    throw new Error(
      "Successful preview response omitted a stable runtime identity.",
    );
  }
  const files = (Array.isArray(root.files) ? root.files : []).flatMap(
    (value) => {
      const safe = safeFile(value);
      return safe ? [safe] : [];
    },
  );
  const protectedFiles = new Map<string, SafePreviewFile>();
  (Array.isArray(root.files) ? root.files : []).forEach((value) => {
    const raw = object(value);
    const safe = safeFile(value);
    if (!safe || typeof raw.url !== "string") return;
    protectedFiles.set(new URL(raw.url, response.url()).pathname, safe);
  });
  const supports = Array.isArray(root.supports) ? root.supports : [];
  const registeredRuntimeIds = Array.from(
    new Set(
      [
        selectedRuntimeId,
        ...supports.map((support) => runtimeId(object(support))),
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort();
  const path = new URL(response.url()).pathname;
  const endpointFamily = PREVIEW_PATH.exec(path)?.[1] ?? "unknown";
  return {
    snapshot: {
      endpointFamily,
      responseStatus: response.status(),
      selected: {
        kind: String(item.kind ?? "unknown"),
        logicalKey:
          typeof item.logical_key === "string" ? item.logical_key : null,
        name: String(item.name ?? "unknown"),
        runtimeId: selectedRuntimeId,
      },
      registeredRuntimeIds,
      registeredResources: files,
      successfulProtectedResources: [],
    },
    protectedFiles,
  };
}

/** Observe real preview preparation and protected bytes without interception. */
export class PreviewNetworkRecorder {
  private readonly page: Page;
  private readonly onResponse: (response: Response) => void;
  private readonly pending = new Set<Promise<void>>();
  private readonly errors: Error[] = [];
  private readonly snapshots: PreviewNetworkSnapshot[] = [];
  private readonly protectedFiles = new Map<string, SafePreviewFile>();

  constructor(page: Page) {
    this.page = page;
    this.onResponse = (response) => {
      const pending = this.recordResponse(response).catch((cause) => {
        this.errors.push(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      });
      this.pending.add(pending);
      void pending.then(() => this.pending.delete(pending));
    };
    page.on("response", this.onResponse);
  }

  private async recordResponse(response: Response): Promise<void> {
    if (response.status() < 200 || response.status() >= 300) return;
    const path = new URL(response.url()).pathname;
    if (PREVIEW_PATH.test(path)) {
      const result = sanitizedPreview(response, await response.json());
      result.protectedFiles.forEach((file, resourcePath) =>
        this.protectedFiles.set(resourcePath, file),
      );
      this.snapshots.push(result.snapshot);
      return;
    }
    if (!PROTECTED_FILE_PATH.test(path)) return;
    const file = this.protectedFiles.get(path);
    if (!file) return;
    this.snapshots.at(-1)?.successfulProtectedResources.push({
      ...file,
      status: response.status(),
    });
  }

  private async settle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    if (this.errors.length > 0) throw this.errors[0];
  }

  async waitForPreview(
    expectedRuntimeId: string,
    timeoutMs = 15_000,
  ): Promise<PreviewNetworkSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      await this.settle();
      const snapshot = this.snapshots.find(
        (candidate) => candidate.selected.runtimeId === expectedRuntimeId,
      );
      if (snapshot) return snapshot;
      await this.page.waitForTimeout(100);
    }
    throw new Error(
      `No successful preview response selected runtime ${expectedRuntimeId}.`,
    );
  }

  async requireResources(
    expectedFilenames: readonly string[],
    timeoutMs = 10_000,
  ): Promise<PreviewNetworkSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      await this.settle();
      const snapshot = this.snapshots.at(-1);
      const successful = new Set(
        snapshot?.successfulProtectedResources.map((file) => file.filename),
      );
      if (snapshot && expectedFilenames.every((name) => successful.has(name))) {
        return snapshot;
      }
      await this.page.waitForTimeout(100);
    }
    const observed =
      this.snapshots
        .at(-1)
        ?.successfulProtectedResources.map((file) => file.filename) ?? [];
    throw new Error(
      `Prepared resource requests did not include ${expectedFilenames.join(
        ", ",
      )}; observed ${observed.join(", ") || "none"}.`,
    );
  }

  async attach(evidence: EvidenceAttachment, name: string): Promise<void> {
    await this.settle();
    await evidence.attachJson(name, this.snapshots.at(-1) ?? null);
  }

  async dispose(): Promise<void> {
    this.page.off("response", this.onResponse);
    await this.settle();
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function mutationClass(request: Request): string | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return null;
  const path = new URL(request.url()).pathname;
  if (PREVIEW_PATH.test(path)) return null;
  if (
    /^\/v1\/animas\/[^/]+\/(gestures|reactions|idle|music-tracks).*:(plan|commit)$/.test(
      path,
    )
  ) {
    return "anima-loadout-plan-or-commit";
  }
  if (
    /^\/v1\/(poses|gestures|reactions|pose-clips|particle-effects|avatar-effects|scene-effects)(?:\/|$)/.test(
      path,
    )
  ) {
    return "content-catalog-write";
  }
  if (/^\/v1\/content\/items(?:\/|$)/.test(path)) {
    return "content-catalog-write";
  }
  return null;
}

export type CreatorSaveFamily =
  | "gestures"
  | "reactions"
  | "particle-effects"
  | "avatar-effects"
  | "scene-effects";

export type CreatorOwnedResponse = {
  itemId: string;
  revisionSha256: string;
  source: string;
  kind: string;
  logicalKey: string;
  name: string;
  editable: boolean;
};

type CreatorSaveArm = {
  entryName: string;
  family: CreatorSaveFamily;
  logicalKey: string;
  recordOwned: (owned: CreatorOwnedResponse) => Promise<void>;
};

type CreatorDeleteArm = {
  itemId: string;
  revisionSha256: string;
};

function hasExpectedApiOrigin(request: Request, apiOrigin: string): boolean {
  try {
    return new URL(request.url()).origin === apiOrigin;
  } catch {
    return false;
  }
}

function isSafeCreatorRequest(request: Request, apiOrigin: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return true;
  return (
    request.method() === "POST" &&
    hasExpectedApiOrigin(request, apiOrigin) &&
    (PREVIEW_PATH.test(new URL(request.url()).pathname) ||
      new URL(request.url()).pathname === "/v1/content/previews:prepare")
  );
}

function isCreateOnlySaveRequest(request: Request): boolean {
  const contentType = request.headers()["content-type"]?.toLowerCase() ?? "";
  const body = request.postData();
  if (!body) return false;
  if (contentType.includes("multipart/form-data")) {
    return !/content-disposition:[^\r\n]*\bname="(?:catalog_item_id|expected_revision)"/i.test(
      body,
    );
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const fields = new URLSearchParams(body);
    return !fields.has("catalog_item_id") && !fields.has("expected_revision");
  }
  if (contentType.includes("application/json")) {
    try {
      const fields = JSON.parse(body) as Record<string, unknown>;
      return !("catalog_item_id" in fields) && !("expected_revision" in fields);
    } catch {
      return false;
    }
  }
  return false;
}

function exactSaveRequest(
  request: Request,
  arm: CreatorSaveArm,
  apiOrigin: string,
): boolean {
  if (request.method() !== "PUT") return false;
  const url = new URL(request.url());
  if (url.origin !== apiOrigin || url.search) return false;
  const match = new RegExp(`^/v1/${arm.family}/([^/:]+)$`).exec(url.pathname);
  if (!match?.[1]) return false;
  try {
    return (
      decodeURIComponent(match[1]) === arm.entryName &&
      isCreateOnlySaveRequest(request)
    );
  } catch {
    return false;
  }
}

function exactDeleteRequest(
  request: Request,
  arm: CreatorDeleteArm,
  apiOrigin: string,
): boolean {
  if (request.method() !== "DELETE") return false;
  const url = new URL(request.url());
  if (url.origin !== apiOrigin || url.searchParams.size !== 1) return false;
  const match = /^\/v1\/content\/items\/([^/]+)$/.exec(url.pathname);
  if (!match?.[1]) return false;
  try {
    return (
      decodeURIComponent(match[1]) === arm.itemId &&
      url.searchParams.get("expected_revision") === arm.revisionSha256
    );
  } catch {
    return false;
  }
}

/** The Avatar item of a face part correction write, or null. */
function facePartCorrectionItem(
  request: Request,
  apiOrigin: string,
): string | null {
  if (request.method() !== "PUT") return null;
  const url = new URL(request.url());
  if (url.origin !== apiOrigin || url.search) return null;
  const match = /^\/v1\/avatar-content\/([^/]+)\/face-parts$/.exec(
    url.pathname,
  );
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

const CREATOR_KIND_BY_FAMILY: Record<CreatorSaveFamily, string> = {
  gestures: "gesture",
  reactions: "reaction",
  "particle-effects": "particle_effect",
  "avatar-effects": "avatar_effect",
  "scene-effects": "scene_effect",
};

/**
 * Fail closed around creator writes. The guard permits previews by default,
 * then one explicitly armed typed Save and one exact owned-item cleanup.
 */
export class CreatorMutationGuard {
  private static readonly ROUTE_PATTERN = "**/*";
  private readonly page: Page;
  private readonly apiOrigin: string;
  private readonly onRoute: (route: Route) => Promise<void>;
  private readonly onResponse: (response: Response) => void;
  private readonly forbidden: Array<{ method: string; operation: string }> = [];
  private readonly allowed: Array<{ method: string; operation: string }> = [];
  private readonly pending = new Set<Promise<void>>();
  private readonly errors: Error[] = [];
  private saveArm: CreatorSaveArm | null = null;
  private saveRequest: Request | null = null;
  private owned: CreatorOwnedResponse | null = null;
  private deleteArm: CreatorDeleteArm | null = null;
  private deleteObserved = false;
  /** Face part correction writes still permitted, and the Avatars they named. */
  private facePartWrites = 0;
  private readonly facePartItems = new Set<string>();

  private constructor(page: Page, apiUrl: string) {
    this.page = page;
    this.apiOrigin = new URL(apiUrl).origin;
    this.onRoute = async (route) => {
      if (this.recordRequest(route.request())) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    };
    this.onResponse = (response) => {
      if (response.request() !== this.saveRequest) return;
      const pending = this.bindSaveResponse(response).catch((cause) => {
        this.errors.push(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      });
      this.pending.add(pending);
      void pending.finally(() => this.pending.delete(pending));
    };
  }

  /** Install the blocking policy before navigating to a creator route. */
  static async attach(
    page: Page,
    apiUrl: string,
  ): Promise<CreatorMutationGuard> {
    const guard = new CreatorMutationGuard(page, apiUrl);
    page.on("response", guard.onResponse);
    try {
      await page.route(CreatorMutationGuard.ROUTE_PATTERN, guard.onRoute);
    } catch (error) {
      page.off("response", guard.onResponse);
      throw error;
    }
    return guard;
  }

  /** Arm only after the matching planned ledger event has been fsynced. */
  armSave(arm: CreatorSaveArm): void {
    if (this.saveArm || this.saveRequest || this.owned) {
      throw new Error("A creator Save has already been armed or observed.");
    }
    if (!arm.entryName.trim()) {
      throw new Error("Creator Save requires one exact generated entry name.");
    }
    if (!arm.logicalKey.trim()) {
      throw new Error("Creator Save requires one exact planned logical key.");
    }
    this.saveArm = arm;
  }

  /** Arm deletion only for the exact identity bound from the Save response. */
  armDelete(arm: CreatorDeleteArm): void {
    if (!this.owned) {
      throw new Error("Creator cleanup cannot be armed before owned content.");
    }
    if (
      arm.itemId !== this.owned.itemId ||
      arm.revisionSha256 !== this.owned.revisionSha256
    ) {
      throw new Error("Creator cleanup identity does not match owned content.");
    }
    if (this.deleteArm || this.deleteObserved) {
      throw new Error("Creator cleanup has already been armed or observed.");
    }
    this.deleteArm = arm;
  }

  /**
   * Permit `count` face part correction writes (for example a correction and
   * its reset) to `PUT /v1/avatar-content/{item}/face-parts`. They change an
   * Avatar's correction, not catalog content; the journey must restore it.
   */
  armFacePartCorrections(count: number): void {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Face part corrections need a positive write budget.");
    }
    this.facePartWrites += count;
  }

  /** Avatar item IDs whose face parts the journey wrote. */
  get correctedAvatarItems(): string[] {
    return [...this.facePartItems];
  }

  /** Record fixture-owned API cleanup, which is outside the browser Page. */
  recordExternalDelete(arm: CreatorDeleteArm): void {
    if (
      !this.deleteArm ||
      this.deleteArm.itemId !== arm.itemId ||
      this.deleteArm.revisionSha256 !== arm.revisionSha256 ||
      this.deleteObserved
    ) {
      throw new Error("Unarmed or duplicate creator cleanup was attempted.");
    }
    this.deleteObserved = true;
    this.allowed.push({ method: "DELETE", operation: "owned-content-cleanup" });
  }

  private recordRequest(request: Request): boolean {
    if (isSafeCreatorRequest(request, this.apiOrigin)) return true;
    if (
      this.saveArm &&
      !this.saveRequest &&
      exactSaveRequest(request, this.saveArm, this.apiOrigin)
    ) {
      this.saveRequest = request;
      this.allowed.push({
        method: request.method(),
        operation: "typed-local-save",
      });
      return true;
    }
    const facePartItem =
      this.facePartWrites > 0
        ? facePartCorrectionItem(request, this.apiOrigin)
        : null;
    if (facePartItem) {
      this.facePartWrites -= 1;
      this.facePartItems.add(facePartItem);
      this.allowed.push({
        method: request.method(),
        operation: "face-part-correction",
      });
      return true;
    }
    if (
      this.deleteArm &&
      !this.deleteObserved &&
      exactDeleteRequest(request, this.deleteArm, this.apiOrigin)
    ) {
      this.deleteObserved = true;
      this.allowed.push({
        method: request.method(),
        operation: "owned-content-cleanup",
      });
      return true;
    }
    this.forbidden.push({
      method: request.method(),
      operation: mutationClass(request) ?? "unclassified-state-change",
    });
    return false;
  }

  private async bindSaveResponse(response: Response): Promise<void> {
    if (!this.saveArm) {
      throw new Error("The creator Save response arrived without an arm.");
    }
    if (!response.ok()) {
      throw new Error(
        `The armed creator Save returned HTTP ${response.status()}.`,
      );
    }
    const body = (await response.json()) as Record<string, unknown>;
    const owned = {
      itemId: typeof body.item_id === "string" ? body.item_id : "",
      revisionSha256:
        typeof body.revision_sha256 === "string" ? body.revision_sha256 : "",
      source: typeof body.source === "string" ? body.source : "",
      kind: typeof body.kind === "string" ? body.kind : "",
      logicalKey: typeof body.logical_key === "string" ? body.logical_key : "",
      name: typeof body.name === "string" ? body.name : "",
      editable: body.editable === true,
    };
    if (!owned.itemId || !/^[0-9a-f]{64}$/.test(owned.revisionSha256)) {
      throw new Error(
        "The armed creator Save omitted its exact catalog identity.",
      );
    }
    if (
      owned.source !== "local" ||
      owned.kind !== CREATOR_KIND_BY_FAMILY[this.saveArm.family] ||
      owned.logicalKey !== this.saveArm.logicalKey ||
      owned.name !== this.saveArm.entryName ||
      !owned.editable
    ) {
      throw new Error(
        "The armed creator Save response did not match its planned editable Local identity fields.",
      );
    }
    await this.saveArm.recordOwned(owned);
    this.owned = owned;
  }

  async waitForOwned(timeoutMs = 15_000): Promise<CreatorOwnedResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      await this.settle();
      if (this.owned) return this.owned;
      await this.page.waitForTimeout(50);
    }
    throw new Error("The armed creator Save did not produce owned content.");
  }

  private async settle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    if (this.errors.length > 0) throw this.errors[0];
  }

  async assertPolicy(evidence: EvidenceAttachment): Promise<void> {
    await this.settle();
    await evidence.attachJson("creator-mutation-policy", {
      allowed: this.allowed,
      forbidden: this.forbidden,
      owned: this.owned
        ? {
            itemId: this.owned.itemId,
            revisionSha256: this.owned.revisionSha256,
          }
        : null,
    });
    if (this.forbidden.length > 0) {
      throw new Error(
        `Creator journey issued ${this.forbidden.length} forbidden mutation request(s).`,
      );
    }
  }

  async dispose(): Promise<void> {
    await this.page.unroute(CreatorMutationGuard.ROUTE_PATTERN, this.onRoute);
    this.page.off("response", this.onResponse);
    await this.settle();
  }
}

/** Guard read-only journeys and compare loadout bodies without retaining them. */
export class ReadOnlyJourneyGuard {
  private readonly page: Page;
  private readonly onRequest: (request: Request) => void;
  private readonly onResponse: (response: Response) => void;
  private readonly mutations: Array<{ method: string; operation: string }> = [];
  private readonly loadouts = new Map<string, unknown[]>();
  private readonly pending = new Set<Promise<void>>();
  private readonly errors: Error[] = [];

  constructor(page: Page) {
    this.page = page;
    this.onRequest = (request) => {
      const operation = mutationClass(request);
      if (operation)
        this.mutations.push({ method: request.method(), operation });
    };
    this.onResponse = (response) => {
      const pending = this.recordLoadout(response).catch((cause) => {
        this.errors.push(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      });
      this.pending.add(pending);
      void pending.then(() => this.pending.delete(pending));
    };
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
  }

  private async recordLoadout(response: Response): Promise<void> {
    if (!response.ok() || response.request().method() !== "GET") return;
    const match = /^\/v1\/animas\/([^/]+)\/loadout$/.exec(
      new URL(response.url()).pathname,
    );
    if (!match?.[1]) return;
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      // A fast client-side navigation can supersede an older response after
      // headers arrive but before CDP exposes its body. Ignore only that
      // Playwright race; verifyLoadoutUnchanged still requires a later valid
      // baseline and post-journey body, so this cannot turn missing evidence
      // into a pass.
      if (
        cause instanceof Error &&
        cause.message.includes("No resource with given identifier found")
      ) {
        return;
      }
      throw cause;
    }
    const snapshots = this.loadouts.get(match[1]) ?? [];
    snapshots.push(body);
    this.loadouts.set(match[1], snapshots);
  }

  private async settle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    if (this.errors.length > 0) throw this.errors[0];
  }

  async verifyLoadoutUnchanged(
    animaId: string,
    evidence: EvidenceAttachment,
  ): Promise<void> {
    await this.settle();
    const beforeSnapshots = this.loadouts.get(animaId) ?? [];
    const before = beforeSnapshots.at(-1);
    if (!before) {
      throw new Error(
        `No authenticated baseline loadout was observed for Annie (${animaId}).`,
      );
    }
    const priorCount = beforeSnapshots.length;
    await this.page.reload({ waitUntil: "domcontentloaded" });
    const deadline = Date.now() + 15_000;
    while (Date.now() <= deadline) {
      await this.settle();
      if ((this.loadouts.get(animaId)?.length ?? 0) > priorCount) break;
      await this.page.waitForTimeout(100);
    }
    const after = this.loadouts.get(animaId)?.at(-1);
    if (!after || (this.loadouts.get(animaId)?.length ?? 0) <= priorCount) {
      throw new Error(
        "The post-journey Annie loadout response was not observed.",
      );
    }
    const beforeDigest = digest(before);
    const afterDigest = digest(after);
    await evidence.attachJson("annie-loadout-read-only-check", {
      beforeSha256: beforeDigest,
      afterSha256: afterDigest,
      unchanged: beforeDigest === afterDigest,
    });
    if (beforeDigest !== afterDigest) {
      throw new Error(
        "Annie's loadout changed during a read-only preview journey.",
      );
    }
  }

  async assertNoMutations(evidence: EvidenceAttachment): Promise<void> {
    await evidence.attachJson("read-only-request-check", {
      forbiddenMutationCount: this.mutations.length,
      forbiddenMutations: this.mutations,
    });
    if (this.mutations.length > 0) {
      throw new Error(
        `Read-only journey issued ${this.mutations.length} catalog/loadout mutation request(s).`,
      );
    }
  }

  async dispose(): Promise<void> {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
    await this.settle();
  }
}
