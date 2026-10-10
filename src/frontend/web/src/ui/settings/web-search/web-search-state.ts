import type {
  PyWebSearchSettings,
  PyWebSearchSettingsRequest,
  PyWebSearchTestResult,
} from "@animama/runtime-contracts/api-types";
import { getI18n } from "react-i18next";

import { errorWording } from "@/lib/errors/apiError";

/** The self-hosted variable suggested for a Brave Search key. */
export const BRAVE_KEY_ENV = "BRAVE_SEARCH_API_KEY";

export type WebSearchBackendChoice = "off" | "searxng" | "brave";

/** The Web search form's editable state; a key is never prefilled. */
export type WebSearchDraft = {
  backend: WebSearchBackendChoice;
  baseUrl: string;
  /** Desktop: a new Brave key to store in the vault. */
  key: string;
  /** Self-hosted web: the environment variable holding the Brave key. */
  envName: string;
  timeout: string;
};

export function draftFromSettings(
  settings: PyWebSearchSettings,
): WebSearchDraft {
  return {
    backend: settings.backend ?? "off",
    baseUrl: settings.base_url ?? "",
    key: "",
    envName:
      settings.credential_env &&
      settings.credential_env !== settings.managed_credential_env
        ? settings.credential_env
        : BRAVE_KEY_ENV,
    timeout:
      settings.timeout_seconds != null ? String(settings.timeout_seconds) : "",
  };
}

/**
 * The settings request for a draft, or `null` while it is incomplete. On
 * desktop (`managedKeys`) a Brave key is stored in the encrypted vault under
 * the managed name, so the request only says "managed"; self-hosted web names
 * the environment variable instead. SearXNG never takes a key.
 */
export function webSearchRequest(
  draft: WebSearchDraft,
  {
    managedKeys,
    savedManagedKey,
  }: { managedKeys: boolean; savedManagedKey: boolean },
): PyWebSearchSettingsRequest | null {
  if (draft.backend === "off") return null;
  const timeoutText = draft.timeout.trim();
  const timeout = timeoutText ? Number(timeoutText) : null;
  if (timeout !== null && !(Number.isFinite(timeout) && timeout > 0))
    return null;
  if (draft.backend === "searxng") {
    const baseUrl = draft.baseUrl.trim();
    if (!baseUrl) return null;
    return {
      backend: "searxng",
      base_url: baseUrl,
      credential: { mode: "none" },
      timeout_seconds: timeout,
    };
  }
  if (managedKeys) {
    if (!draft.key.trim() && !savedManagedKey) return null;
    return {
      backend: "brave",
      credential: { mode: "managed" },
      timeout_seconds: timeout,
    };
  }
  const env = draft.envName.trim();
  if (!env) return null;
  return {
    backend: "brave",
    credential: { mode: "env", env },
    timeout_seconds: timeout,
  };
}

/** Plain-language text for a Test result; server response text is never shown. */
export function testResultMessage(result: PyWebSearchTestResult): string {
  if (result.ok) {
    const count = result.result_count ?? 0;
    return `Search works: ${count} ${count === 1 ? "result" : "results"} for a test query.`;
  }
  return (
    (result.category && errorWording("webSearch", result.category)) ||
    getI18n().t("errors:webSearch.bad_response")
  );
}
