import {
  useEffect,
  useId,
  useImperativeHandle,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  credentialProviders,
  credentialTarget,
  isProviderCredential,
  type CredentialProvider,
  type CredentialStatus,
} from "../../../../shared/desktop-runtime";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import {
  credentialChangesFromDrafts,
  credentialFailureMessage,
  saveCredentialChanges,
  type CredentialDrafts,
} from "./desktop-credential-state";

const names: Record<CredentialProvider, string> = {
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};

const EMPTY_STATUSES: CredentialStatus[] = [];

/**
 * Lets a host act on unsaved edits it cannot see, for example setup's prompt
 * to save or discard before leaving a step. `save` resolves to whether every
 * change finished (true when there was nothing to save).
 */
export type DesktopCredentialsController = {
  save: () => Promise<boolean>;
  discard: () => void;
};

/** A readable name for a provider or a model connection's key variable. */
function credentialName(target: string): string {
  return target in names
    ? names[target as CredentialProvider]
    : "Model connection key";
}

/** Main retains failures across window recreation, including for an unselected provider. */
export function DesktopCredentialFailures({
  statuses,
}: {
  statuses: CredentialStatus[];
}) {
  return statuses.map((status) => {
    const message = credentialFailureMessage(status);
    const target = credentialTarget(status);
    return message ? (
      <p className="text-sm" role="status" key={target}>
        {credentialName(target)}: {message}
      </p>
    ) : null;
  });
}

/**
 * Whether provider keys can be managed here: the main window of a desktop app
 * running its embedded runtime (not the external development stack). Cached
 * per owner, so every key panel agrees.
 */
export function useDesktopCredentialsAvailable(): boolean {
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const owner = useRuntimeCacheKey() ?? "__anon__";
  const runtime = desktop?.runtime;
  const enabled = Boolean(
    runtime && desktop?.credentials && desktop.windowRole === "main",
  );
  const query = useQuery({
    queryKey: queryKeys.desktopCredentials.available(owner),
    enabled,
    // Recovery surfaces runtime failures; keys stay hidden meanwhile.
    retry: false,
    queryFn: async () => (await runtime!.status()).state !== "external",
  });
  return enabled && query.data === true;
}

/**
 * Saved key status from main (never values), shared through the query cache
 * so the API Keys section and every feature-local key field show the same
 * state after a save in any of them.
 */
function useDesktopCredentialStatuses(enabled: boolean) {
  const platform = useRuntimePlatform();
  const bridge =
    platform.kind === "desktop" ? platform.desktopBridge.credentials : null;
  const owner = useRuntimeCacheKey() ?? "__anon__";
  return useQuery({
    queryKey: queryKeys.desktopCredentials.statuses(owner),
    enabled: enabled && Boolean(bridge),
    retry: false,
    queryFn: () => bridge!.list(),
  });
}

/**
 * Whether a provider key is saved, from the same shared status as the key
 * panels; null where keys are not managed here (or status is unknown).
 */
export function useDesktopCredentialConfigured(
  provider: CredentialProvider,
): boolean | null {
  const available = useDesktopCredentialsAvailable();
  const query = useDesktopCredentialStatuses(available);
  if (!available || !query.isSuccess) return null;
  return query.data.some(
    (item) =>
      isProviderCredential(item) &&
      item.provider === provider &&
      item.configured,
  );
}

/**
 * Optional provider API keys (desktop embedded runtime only). Keys are
 * write-only: main stores them encrypted and reports status, never values.
 * Several edits are saved together and apply without reloading the window or
 * restarting the backend. `providers` limits the panel to the keys a feature
 * needs (the OpenAI model card, Voice settings); API Keys shows them all.
 */
export function DesktopCredentialsPanel({
  onBusyChange,
  onPendingChange,
  className,
  showTitle = true,
  providers = credentialProviders,
  description,
  controllerRef,
}: {
  onBusyChange?: (busy: boolean) => void;
  /** Number of unsaved key edits, so a host (setup) can prevent losing them. */
  onPendingChange?: (count: number) => void;
  className?: string;
  /** The App Settings section already names itself "API Keys". */
  showTitle?: boolean;
  /** The keys to show, in this order. */
  providers?: readonly CredentialProvider[];
  /** Replaces the general explanation; `null` shows none. */
  description?: ReactNode;
  /** Save or discard unsaved edits from outside the panel. */
  controllerRef?: Ref<DesktopCredentialsController>;
}) {
  const available = useDesktopCredentialsAvailable();
  const statusQuery = useDesktopCredentialStatuses(available);
  const statuses = statusQuery.data ?? EMPTY_STATUSES;
  const [drafts, setDrafts] = useState<CredentialDrafts>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ownerId = useRuntimeCacheKey();
  const queryClient = useQueryClient();
  const id = useId();
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const bridge = desktop?.credentials;

  const changes = credentialChangesFromDrafts(drafts);
  const pendingCount = changes.length;
  useEffect(() => {
    onPendingChange?.(pendingCount);
  }, [onPendingChange, pendingCount]);

  const isConfigured = (provider: CredentialProvider) =>
    statuses.some(
      (item) =>
        isProviderCredential(item) &&
        item.provider === provider &&
        item.configured,
    );
  const updateDraft = (
    provider: CredentialProvider,
    next: { value?: string; remove?: boolean },
  ) => {
    if (busy) return;
    setDrafts((current) => ({ ...current, [provider]: next }));
    setMessage(null);
  };

  const save = async (): Promise<boolean> => {
    if (changes.length === 0) return true;
    if (!bridge || busy) return false;
    // Clear typed keys before IPC; there is no read-back or browser copy.
    setDrafts({});
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    try {
      const result = await saveCredentialChanges(
        queryClient,
        ownerId,
        bridge,
        changes,
      );
      setMessage(
        result.ok
          ? "Saved."
          : result.failed.length
            ? `Some changes could not finish (${result.failed.map(credentialName).join(", ")}). Retry them; saved keys are never shown here.`
            : "The changes could not finish. Check runtime recovery, then retry. Saved keys are never shown here.",
      );
      return result.ok;
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const discard = () => {
    setDrafts({});
    setMessage(null);
  };
  useImperativeHandle(controllerRef, () => ({ save, discard }));

  if (!available) return null;
  const shown = new Set<string>(providers);
  // A filtered panel reports only its own keys' failures; the full panel
  // also reports model connection keys.
  const failures = credentialProviders.every((provider) => shown.has(provider))
    ? statuses
    : statuses.filter((status) => shown.has(credentialTarget(status)));

  return (
    <section
      className={cn(
        "border-border/60 bg-muted/10 space-y-4 rounded-xl border p-5",
        className,
      )}
      aria-busy={busy}
      aria-label={showTitle ? undefined : "API keys"}
    >
      {showTitle || description !== null ? (
        <div className="space-y-2">
          {showTitle ? (
            <h3 className="text-base font-semibold">
              API keys{" "}
              <span className="text-muted-foreground text-sm font-normal">
                (optional)
              </span>
            </h3>
          ) : null}
          {description === undefined ? (
            <p className="text-muted-foreground text-sm">
              Add an OpenAI key for cloud chat or an ElevenLabs key for voices.
              Keys for other model servers are entered on each connection in App
              Settings → Models. Keys are encrypted with this computer’s secure
              storage and never shown again. Changes apply as soon as you save.
              You can change them later in App Settings → API Keys.
            </p>
          ) : description !== null ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="divide-border/60 divide-y">
        {providers.map((provider) => {
          const configured = isConfigured(provider);
          const draft = drafts[provider];
          const removing = Boolean(draft?.remove) && !draft?.value?.trim();
          return (
            <div
              key={provider}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
            >
              <div className="min-w-0 flex-1 basis-40">
                <Label htmlFor={`${id}-${provider}`}>{names[provider]}</Label>
                <p
                  id={`${id}-${provider}-status`}
                  className="text-muted-foreground text-xs"
                >
                  {removing
                    ? "Will be removed when you save."
                    : configured
                      ? "Configured"
                      : "Not set"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-${provider}`}
                  aria-describedby={`${id}-${provider}-status`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={8192}
                  className="w-56"
                  value={draft?.value ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    updateDraft(provider, { value: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      // Also keeps the setup form from submitting.
                      event.preventDefault();
                      void save();
                    }
                  }}
                  placeholder={
                    configured ? "Enter a new key to replace" : "API key"
                  }
                />
                {/* Fixed slot keeps inputs aligned whether or not a key is set. */}
                <div className="w-20">
                  {configured ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`${removing ? "Undo removing" : "Remove"} ${names[provider]} key`}
                      onClick={() =>
                        updateDraft(provider, removing ? {} : { remove: true })
                      }
                    >
                      {removing ? "Undo" : "Remove"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || changes.length === 0}
          onClick={() => void save()}
        >
          {busy
            ? "Saving…"
            : changes.length > 1
              ? `Save ${changes.length} changes`
              : "Save"}
        </Button>
        {changes.length > 0 && !busy ? (
          <Button type="button" size="sm" variant="ghost" onClick={discard}>
            Discard
          </Button>
        ) : null}
      </div>
      {statusQuery.isError ? (
        <p className="text-sm" role="status">
          Protected settings are unavailable. Open runtime recovery and try
          again.
        </p>
      ) : null}
      <DesktopCredentialFailures statuses={failures} />
      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
