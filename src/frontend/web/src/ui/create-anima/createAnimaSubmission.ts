import type {
  AnimaCreationErrorDetail,
  AnimaSpecInput,
} from "@animama/runtime-contracts/sdk";
import { zAnimaCreationDiagnostic } from "@animama/runtime-contracts/validators";
import {
  canonicalJson,
  creationRequestSchema,
  type CreateAnimaDraft,
  type FrozenCreationRequest,
} from "./createAnimaDraft";

/** Reuse the last resolved command only when the normalized body is identical. */
export function freezeCreation(
  draft: CreateAnimaDraft,
  spec: AnimaSpecInput,
): FrozenCreationRequest {
  const previous = draft.submission?.request;
  if (previous) {
    const oldSpec = Object.fromEntries(
      Object.entries(previous).filter(([key]) => key !== "idempotency_key"),
    );
    if (canonicalJson(oldSpec) === canonicalJson(spec))
      return structuredClone(previous);
    if (draft.submission?.state !== "rejected")
      throw new Error(
        "Check the previous creation result before changing this request.",
      );
  }
  return creationRequestSchema.parse({
    ...spec,
    idempotency_key: crypto.randomUUID(),
  });
}

export type CreationFailure = {
  state: "unknown" | "rejected" | "conflict" | "deleted";
  detail: AnimaCreationErrorDetail;
};

/** An unclassified response cannot prove rollback; keep the original command frozen. */
export function classifyCreationFailure(
  error: unknown,
  status?: number,
): CreationFailure {
  const candidate =
    error && typeof error === "object" && "detail" in error
      ? error.detail
      : null;
  const raw =
    candidate && typeof candidate === "object"
      ? (candidate as Partial<AnimaCreationErrorDetail>)
      : {};
  const detail: AnimaCreationErrorDetail = {
    code: typeof raw.code === "string" ? raw.code : "creation_outcome_unknown",
    message:
      typeof raw.message === "string"
        ? raw.message
        : "We couldn't confirm whether your Anima was created.",
    retryable: raw.retryable === true,
    issues: Array.isArray(raw.issues)
      ? raw.issues.slice(0, 100).flatMap((issue) => {
          const result = zAnimaCreationDiagnostic.safeParse(issue);
          return result.success ? [result.data] : [];
        })
      : [],
  };
  let state: CreationFailure["state"] = "unknown";
  if (status === 409 && detail.code === "idempotency_key_reused")
    state = "conflict";
  else if (status === 410 && detail.code === "creation_result_deleted")
    state = "deleted";
  else if (
    (status === 422 && detail.code === "anima_creation_invalid") ||
    (status === 404 && detail.code === "anima_creation_source_unavailable") ||
    (status === 409 && detail.code === "anima_creation_sources_stale") ||
    (status === 503 && detail.code === "anima_creation_defaults_unavailable")
  )
    state = "rejected";
  return { state, detail };
}
