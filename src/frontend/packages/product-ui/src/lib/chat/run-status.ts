import type { TFunction } from "i18next";
import { productEnglishT } from "../../i18n/product-translation";

/**
 * In-stream `run.status` frames: work the backend does before or between
 * reply text, shown in the pending assistant bubble.
 */
export type ChatRunStatusKind = "summarizing_context" | "searching_web";

export type ChatRunStatus = {
  type: "run.status";
  run_id: string;
  status: ChatRunStatusKind;
  phase: "started" | "finished";
};

const RUN_STATUS_KINDS: ReadonlySet<string> = new Set<ChatRunStatusKind>([
  "summarizing_context",
  "searching_web",
]);

export function isChatRunStatus(value: unknown): value is ChatRunStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === "run.status" &&
    typeof record.run_id === "string" &&
    typeof record.status === "string" &&
    RUN_STATUS_KINDS.has(record.status) &&
    (record.phase === "started" || record.phase === "finished")
  );
}

/** Text for the pending bubble while the status is active (English unless `t` is given). */
export function chatRunStatusLabel(
  status: ChatRunStatusKind,
  t: TFunction<"product"> = productEnglishT(),
): string {
  switch (status) {
    case "summarizing_context":
      return t("runStatus.summarizing_context");
    case "searching_web":
      return t("runStatus.searching_web");
  }
}
