import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  credentialProviders,
  credentialTarget,
  isProviderCredential,
  type CredentialProvider,
  type CredentialStatus,
} from "../../../../shared/desktop-runtime";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import {
  applyCredentialChanges,
  credentialChangesFromDrafts,
  credentialFailureMessage,
  type CredentialDrafts,
} from "./desktop-credential-state";

const names: Record<CredentialProvider, string> = {
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
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
 * running its embedded runtime (not the external development stack).
 */
export function useDesktopCredentialsAvailable(): boolean {
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const runtime = desktop?.runtime;
    if (!runtime || !desktop?.credentials || desktop.windowRole !== "main")
      return;
    let active = true;
    void runtime
      .status()
      .then((status) => {
        if (active) setAvailable(status.state !== "external");
      })
      .catch(() => {
        // Recovery surfaces runtime failures; keys stay hidden meanwhile.
      });
    return () => {
      active = false;
    };
  }, [desktop]);
  return available;
}

/**
 * Optional provider API keys (desktop embedded runtime only). Keys are
 * write-only: main stores them encrypted and reports status, never values.
 * Several edits are saved together so local services restart once.
 */
export function DesktopCredentialsPanel({
  onBusyChange,
  onPendingChange,
  className,
  showTitle = true,
}: {
  onBusyChange?: (busy: boolean) => void;
  /** Number of unsaved key edits, so a host (setup) can prevent losing them. */
  onPendingChange?: (count: number) => void;
  className?: string;
  /** The App Settings section already names itself "API Keys". */
  showTitle?: boolean;
}) {
  const available = useDesktopCredentialsAvailable();
  const [statuses, setStatuses] = useState<CredentialStatus[]>([]);
  const [drafts, setDrafts] = useState<CredentialDrafts>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ownerId = useRuntimeOwnerId();
  const queryClient = useQueryClient();
  const id = useId();
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const bridge = desktop?.credentials;

  useEffect(() => {
    if (!available || !bridge) return;
    let active = true;
    void bridge
      .list()
      .then((entries) => {
        if (active) setStatuses(entries);
      })
      .catch(() => {
        if (active)
          setMessage(
            "Protected settings are unavailable. Open runtime recovery and try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [available, bridge]);

  const changes = credentialChangesFromDrafts(drafts);
  const pendingCount = changes.length;
  useEffect(() => {
    onPendingChange?.(pendingCount);
  }, [onPendingChange, pendingCount]);

  if (!available) return null;
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
    setDrafts((current) => ({ ...current, [provider]: next }));
    setMessage(null);
  };

  const save = async () => {
    if (!bridge || busy || changes.length === 0) return;
    // Clear typed keys before IPC; there is no read-back or browser copy.
    setDrafts({});
    // Main clears retained failures for the batch; mirror that immediately.
    const changing = new Set(changes.map(credentialTarget));
    setStatuses((entries) =>
      entries.map((entry) => {
        if (!changing.has(credentialTarget(entry))) return entry;
        const status = { ...entry, restartRequired: false };
        delete status.error;
        return status;
      }),
    );
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    try {
      setStatuses(await applyCredentialChanges(bridge, changes));
      await queryClient.invalidateQueries({
        queryKey: queryKeys.modelProviders.all(ownerId ?? "__anon__"),
      });
      setMessage(
        `${changes.length === 1 ? "Change" : `${changes.length} changes`} saved. Local services are ready.`,
      );
    } catch (error) {
      const failed = (error as { failed?: string[] }).failed;
      const reported = (error as { statuses?: CredentialStatus[] }).statuses;
      try {
        setStatuses(reported ?? (await bridge.list()));
      } catch {
        // Keep the previous statuses; the message below explains the failure.
      }
      setMessage(
        failed?.length
          ? `Some changes could not finish (${failed.map(credentialName).join(", ")}). Retry them; saved keys are never shown here.`
          : "The changes could not finish. Check runtime recovery, then retry. Saved keys are never shown here.",
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <section
      className={cn(
        "border-border/60 bg-muted/10 space-y-4 rounded-xl border p-5",
        className,
      )}
      aria-busy={busy}
    >
      <div className="space-y-2">
        <h3 className={cn("text-base font-semibold", !showTitle && "sr-only")}>
          API keys{" "}
          <span className="text-muted-foreground text-sm font-normal">
            (optional)
          </span>
        </h3>
        <p className="text-muted-foreground text-sm">
          Add an OpenAI key for cloud chat or an ElevenLabs key for voices. Keys
          for other model servers are entered on each connection in App Settings
          → Models. Keys are encrypted with this computer’s secure storage and
          never shown again. Enter several, then save once; local services
          restart after saving. You can change them later in App Settings → API
          Keys.
        </p>
      </div>
      <div className="divide-border/60 divide-y">
        {credentialProviders.map((provider) => {
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
            ? "Restarting local services…"
            : changes.length > 1
              ? `Save ${changes.length} changes`
              : "Save"}
        </Button>
        {changes.length > 0 && !busy ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDrafts({});
              setMessage(null);
            }}
          >
            Discard
          </Button>
        ) : null}
      </div>
      <DesktopCredentialFailures statuses={statuses} />
      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
