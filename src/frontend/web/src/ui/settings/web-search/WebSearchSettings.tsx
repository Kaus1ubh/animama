import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import type {
  PyWebSearchSettings,
  PyWebSearchTestResult,
} from "@animama/runtime-contracts/api-types";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useWebSearchSettings } from "@/query/hooks/useWebSearchSettings";
import {
  useClearWebSearchSettings,
  useTestWebSearchSettings,
  useUpdateWebSearchSettings,
} from "@/query/mutations/useWebSearchSettings";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { useDesktopCredentialsAvailable } from "@/ui/settings/DesktopCredentialsPanel";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import {
  applyCredentialChanges,
  credentialFailureMessage,
} from "@/ui/settings/desktop-credential-state";
import type {
  CredentialStatus,
  CredentialsBridge,
} from "../../../../../shared/desktop-runtime";
import { credentialTarget } from "../../../../../shared/desktop-runtime";
import { modelConfigurationErrorMessage } from "@/ui/settings/models/model-configuration-state";

import {
  draftFromSettings,
  testResultMessage,
  webSearchRequest,
  type WebSearchBackendChoice,
  type WebSearchDraft,
} from "./web-search-state";

const BACKEND_LABELS: Record<WebSearchBackendChoice, string> = {
  off: "Off",
  searxng: "SearXNG",
  brave: "Brave Search",
};

/** The desktop vault key this app saved for search, if any. */
function savedVaultKey(
  settings: PyWebSearchSettings | undefined,
  managedKeys: boolean,
): string | null {
  return managedKeys &&
    settings?.credential_env === settings?.managed_credential_env &&
    settings?.credential_state === "configured"
    ? (settings?.managed_credential_env ?? null)
    : null;
}

/** Why the vault did not store or delete the search key, from main's status. */
function vaultFailureReason(error: unknown, env: string): string | null {
  const statuses = (error as { statuses?: CredentialStatus[] }).statuses ?? [];
  const status = statuses.find((item) => credentialTarget(item) === env);
  return status ? credentialFailureMessage(status) : null;
}

/**
 * Delete the saved search key. A failure offers a retry, because nothing else
 * lists the key once the settings no longer name it.
 */
async function deleteSearchKey(
  bridge: CredentialsBridge,
  env: string,
): Promise<void> {
  await applyCredentialChanges(bridge, [{ connection: env }]).catch((error) => {
    const reason = vaultFailureReason(error, env);
    toast.error(
      `The saved Brave Search key could not be deleted.${reason ? ` ${reason}` : ""}`,
      {
        action: {
          label: "Retry",
          onClick: () => void deleteSearchKey(bridge, env),
        },
      },
    );
  });
}

/** Where searches go, in the owner's terms. */
function destinationNote(draft: WebSearchDraft): string | null {
  if (draft.backend === "searxng") {
    let host = "";
    try {
      host = new URL(draft.baseUrl.trim()).host;
    } catch {
      // Not a URL yet; the note stays generic.
    }
    return `Models send their search queries to ${host ? `the SearXNG server at ${host}` : "your SearXNG server"}.`;
  }
  if (draft.backend === "brave")
    return "Models send their search queries to Brave Search, which keeps queries for up to 90 days.";
  return null;
}

/**
 * App Settings → Models → Web search: choose the installation's search
 * backend so any model that calls tools can search the web. SearXNG takes a
 * server address; Brave Search takes an API key, stored in the encrypted
 * vault on desktop (applied immediately) or named as a backend
 * environment variable on self-hosted web. OpenAI Responses models keep
 * their hosted search either way. Chat history keeps only each result's
 * title and link.
 */
export function WebSearchSettings({ disabled }: { disabled: boolean }) {
  const formId = useId();
  const platform = useRuntimePlatform();
  const bridge =
    platform.kind === "desktop"
      ? platform.desktopBridge.credentials
      : undefined;
  const managedKeys = useDesktopCredentialsAvailable();
  const settings = useWebSearchSettings(true);
  const update = useUpdateWebSearchSettings();
  const clear = useClearWebSearchSettings();
  const test = useTestWebSearchSettings();
  const [draft, setDraft] = useState<WebSearchDraft | null>(null);
  const [testResult, setTestResult] = useState<PyWebSearchTestResult | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  // Start from the saved settings once they load; later refetches keep edits.
  useEffect(() => {
    if (settings.data && !draft) setDraft(draftFromSettings(settings.data));
  }, [draft, settings.data]);

  if (settings.isError)
    return (
      <p className="text-muted-foreground py-3 text-sm" role="status">
        Web search settings could not be loaded.
      </p>
    );
  if (!settings.data || !draft) return null;

  const saved = settings.data;
  const vaultKey = savedVaultKey(saved, managedKeys);
  const request = webSearchRequest(draft, {
    managedKeys,
    savedManagedKey: vaultKey !== null,
  });
  const newKey = draft.key.trim();
  const busy = disabled || saving;
  const change = (patch: Partial<WebSearchDraft>) => {
    setTestResult(null);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const runTest = async () => {
    if (!request) return;
    setTestResult(null);
    try {
      setTestResult(await test.mutateAsync(request));
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
    }
  };

  const save = async () => {
    if (!request || busy) return;
    setSaving(true);
    let next: PyWebSearchSettings;
    try {
      next = await update.mutateAsync(request);
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
      setSaving(false);
      return;
    }
    setDraft(draftFromSettings(next));
    toast.success("Web search saved.");
    try {
      if (managedKeys && bridge) {
        if (newKey && next.credential_env === next.managed_credential_env)
          await applyCredentialChanges(bridge, [
            { connection: next.managed_credential_env, value: newKey },
          ]);
        else if (vaultKey && next.credential_env !== vaultKey)
          await deleteSearchKey(bridge, vaultKey);
      }
    } catch (error) {
      const reason = vaultFailureReason(error, next.managed_credential_env);
      toast.error(
        `The Brave Search key was not stored.${reason ? ` ${reason}` : " Enter it again and save."}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const turnOff = async () => {
    if (busy) return;
    setSaving(true);
    try {
      await clear.mutateAsync();
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
      setSaving(false);
      return;
    }
    toast.success("Web search turned off.");
    setDraft(draftFromSettings({ ...saved, configured: false, backend: null }));
    setSaving(false);
    if (vaultKey && bridge) await deleteSearchKey(bridge, vaultKey);
  };

  const note = destinationNote(draft);
  const keyNotSet =
    saved.configured &&
    saved.backend === draft.backend &&
    saved.credential_state === "missing";
  // A new desktop key reaches the backend only after it is saved.
  const testNeedsSave = managedKeys && draft.backend === "brave" && !!newKey;

  return (
    <div className="flex flex-col">
      <SettingsRow
        label="Search service"
        description="Lets any model that can call tools search the web. OpenAI models with built-in search keep using it."
        control={
          <Select
            value={draft.backend}
            disabled={busy}
            onValueChange={(value) =>
              change({ backend: value as WebSearchBackendChoice })
            }
          >
            <SelectTrigger
              id={`${formId}-backend`}
              className="w-56"
              aria-label="Search service"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["off", "searxng", "brave"] as const).map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {BACKEND_LABELS[choice]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {draft.backend === "off" ? (
        saved.configured ? (
          <div className="flex justify-end gap-2 py-3">
            <p className="text-muted-foreground mr-auto self-center text-xs">
              {vaultKey
                ? "Turning search off also deletes its saved key, which cannot be recovered."
                : "Models will stop searching the web."}
            </p>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void turnOff()}
            >
              {saving ? "Turning off…" : "Turn off web search"}
            </Button>
          </div>
        ) : null
      ) : (
        <form
          className="space-y-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {draft.backend === "searxng" ? (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-url`}>SearXNG address</Label>
              <Input
                id={`${formId}-url`}
                value={draft.baseUrl}
                placeholder="http://127.0.0.1:8888"
                inputMode="url"
                disabled={busy}
                onChange={(event) => change({ baseUrl: event.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                Enable the json format under search.formats in its settings.yml.
                From a Docker stack, a server on this computer is at
                host.docker.internal instead of 127.0.0.1.
                {vaultKey
                  ? " Saving deletes the saved Brave Search key, which cannot be recovered."
                  : ""}
              </p>
            </div>
          ) : managedKeys ? (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-key`}>Brave Search API key</Label>
              <Input
                id={`${formId}-key`}
                type="password"
                autoComplete="off"
                value={draft.key}
                placeholder={
                  vaultKey ? "Saved; enter a new key to replace it" : ""
                }
                disabled={busy}
                onChange={(event) => change({ key: event.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                Encrypted on this computer and never shown again. A saved key
                applies immediately.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-env`}>Key environment variable</Label>
              <Input
                id={`${formId}-env`}
                value={draft.envName}
                autoCapitalize="characters"
                disabled={busy}
                onChange={(event) => change({ envName: event.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                The backend reads the Brave Search key from{" "}
                {saved.managed_credential_env} or BRAVE_SEARCH_API_KEY. Keys are
                never stored in the database.
                {keyNotSet ? " It is not set in the backend environment." : ""}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-timeout`}>
              Timeout (seconds){" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id={`${formId}-timeout`}
              value={draft.timeout}
              inputMode="decimal"
              placeholder="15"
              className="w-32"
              disabled={busy}
              onChange={(event) => change({ timeout: event.target.value })}
            />
          </div>
          {note ? (
            <p className="text-muted-foreground text-xs">{note}</p>
          ) : null}
          {testResult ? (
            <p
              role="status"
              className={cn(
                "text-xs",
                testResult.ok ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {testResultMessage(testResult)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {testNeedsSave ? (
              <p className="text-muted-foreground mr-auto text-xs">
                Save to test a new key.
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={busy || !request || testNeedsSave || test.isPending}
              onClick={() => void runTest()}
            >
              {test.isPending ? "Testing…" : "Test"}
            </Button>
            <Button type="submit" disabled={busy || !request}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
