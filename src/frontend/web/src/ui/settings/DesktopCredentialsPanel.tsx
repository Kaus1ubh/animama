import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  credentialProviders,
  type CredentialProvider,
  type CredentialStatus,
} from "../../../../shared/desktop-runtime";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import {
  applyCredentialChange,
  credentialFailureMessage,
} from "./desktop-credential-state";

const names: Record<CredentialProvider, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  huggingface: "Hugging Face",
  gemini: "Gemini",
  elevenlabs: "ElevenLabs",
};

/** Main retains failures across window recreation, including for an unselected provider. */
export function DesktopCredentialFailures({
  statuses,
}: {
  statuses: CredentialStatus[];
}) {
  return statuses.map((status) => {
    const message = credentialFailureMessage(status);
    return message ? (
      <p className="text-sm" role="status" key={status.provider}>
        {names[status.provider]}: {message}
      </p>
    ) : null;
  });
}

/** Optional desktop settings use status-only IPC, never the database or browser storage. */
export function DesktopCredentialsPanel({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [statuses, setStatuses] = useState<CredentialStatus[]>([]);
  const [provider, setProvider] = useState<CredentialProvider>("openai");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ownerId = useRuntimeOwnerId();
  const queryClient = useQueryClient();
  const id = useId();
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const bridge = desktop?.credentials;

  useEffect(() => {
    const runtime = desktop?.runtime;
    if (!runtime || !bridge || desktop?.windowRole !== "main") return;
    let active = true;
    void runtime
      .status()
      .then(async (status) => {
        if (status.state === "external" || !active) return;
        setAvailable(true);
        const entries = await bridge.list();
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
  }, [bridge, desktop]);

  if (!available) return null;
  const configured =
    statuses.find((item) => item.provider === provider)?.configured ?? false;

  const save = async (remove = false) => {
    if (!bridge || busy) return;
    const submitted = value.trim();
    // Clear the input before IPC; there is no read-back or localStorage copy.
    setValue("");
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    setStatuses((entries) =>
      entries.map((entry) => {
        if (entry.provider !== provider) return entry;
        const status = { ...entry, restartRequired: false };
        delete status.error;
        return status;
      }),
    );
    try {
      setStatuses(
        await applyCredentialChange(
          bridge,
          provider,
          remove ? undefined : submitted,
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.modelProviders.all(ownerId ?? "__anon__"),
      });
      setMessage(
        remove
          ? "Key removed. Local services are ready."
          : "Key saved. Local services are ready.",
      );
    } catch {
      const failureMessage =
        "The change could not finish. Check runtime recovery, then retry. Saved keys are never shown here.";
      try {
        const entries = await bridge.list();
        setStatuses(entries);
        if (!entries.find((entry) => entry.provider === provider)?.error)
          setMessage(failureMessage);
      } catch {
        setMessage(failureMessage);
      }
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <section
      className="border-border/60 bg-muted/10 space-y-4 rounded-xl border p-5"
      aria-busy={busy}
    >
      <div className="space-y-2">
        <h3 className="text-base font-semibold">
          Provider keys{" "}
          <span className="text-muted-foreground text-sm font-normal">
            (optional)
          </span>
        </h3>
        <p className="text-muted-foreground text-sm">
          Add your own provider key for cloud chat or ElevenLabs voices. Keys
          are encrypted with this computer’s secure storage and are never
          displayed again. You can do this later in Settings.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-provider`}>Provider</Label>
        <select
          id={`${id}-provider`}
          value={provider}
          disabled={busy}
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          onChange={(event) => {
            setProvider(event.target.value as CredentialProvider);
            setValue("");
            setMessage(null);
          }}
        >
          {credentialProviders.map((item) => (
            <option key={item} value={item}>
              {names[item]}
              {statuses.some(
                (status) => status.provider === item && status.configured,
              )
                ? " — configured"
                : ""}
            </option>
          ))}
        </select>
        <Label htmlFor={`${id}-key`}>
          {configured ? "Replace key" : "API key"}
        </Label>
        <Input
          id={`${id}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={8192}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (value.trim() && !busy) void save();
            }
          }}
          placeholder={
            configured
              ? "Configured — enter a new key to replace it"
              : "Optional"
          }
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !value.trim()}
          onClick={() => void save()}
        >
          {busy ? "Restarting local services…" : "Save key"}
        </Button>
        {configured ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Remove key
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
