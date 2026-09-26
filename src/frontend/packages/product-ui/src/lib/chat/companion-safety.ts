import type { PyChatClientContext } from "@animama/runtime-contracts/api-types";

/** App-rendered AI notice for one turn (`safety.ai_notice`, spec R2). */
export type ChatAiNotice = {
  type: "safety.ai_notice";
  run_id: string;
  kind: "start" | "reminder";
  anima_name?: string | null;
};

export type CrisisContact = {
  kind: "phone" | "sms" | "chat";
  label: string;
  value: string;
};

export type CrisisService = {
  name: string;
  description?: string | null;
  contacts: CrisisContact[];
};

/** Resolved crisis-resource region carried by the crisis card. */
export type CrisisResourceRegion = {
  code: string;
  label: string;
  emergency_number?: string | null;
  services: CrisisService[];
  source_url?: string | null;
  verified_on: string;
};

/** Deterministic crisis card for one turn (`safety.crisis_support`, spec R4). */
export type ChatCrisisSupport = {
  type: "safety.crisis_support";
  run_id: string;
  source: "local" | "moderation";
  resources: CrisisResourceRegion;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isChatAiNotice(value: unknown): value is ChatAiNotice {
  return (
    isRecord(value) &&
    value.type === "safety.ai_notice" &&
    typeof value.run_id === "string" &&
    (value.kind === "start" || value.kind === "reminder")
  );
}

export function isChatCrisisSupport(
  value: unknown,
): value is ChatCrisisSupport {
  return (
    isRecord(value) &&
    value.type === "safety.crisis_support" &&
    typeof value.run_id === "string" &&
    isRecord(value.resources) &&
    typeof value.resources.label === "string" &&
    Array.isArray(value.resources.services)
  );
}

/** Time zone and locale sent with each chat turn for the notice day and resource region. */
export function currentChatClientContext(): PyChatClientContext {
  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    timeZone = null;
  }
  const locale =
    typeof navigator !== "undefined" && typeof navigator.language === "string"
      ? navigator.language
      : null;
  return { time_zone: timeZone, locale };
}
