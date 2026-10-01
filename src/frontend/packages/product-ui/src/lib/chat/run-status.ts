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

const runStatusLabels: Record<ChatRunStatusKind, string> = {
  summarizing_context: "Summarizing earlier conversation…",
  searching_web: "Searching the web…",
};

export function isChatRunStatus(value: unknown): value is ChatRunStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === "run.status" &&
    typeof record.run_id === "string" &&
    typeof record.status === "string" &&
    Object.hasOwn(runStatusLabels, record.status) &&
    (record.phase === "started" || record.phase === "finished")
  );
}

/** Text for the pending bubble while the status is active. */
export function chatRunStatusLabel(status: ChatRunStatusKind): string {
  return runStatusLabels[status];
}
