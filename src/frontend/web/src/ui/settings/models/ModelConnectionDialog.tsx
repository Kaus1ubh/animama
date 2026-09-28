import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type {
  PyModelConnection,
  PyModelConnectionCompatibility,
  PyModelConnectionCredential,
  PyModelConnectionDetection,
  PyModelConnectionPreset,
} from "@animama/runtime-contracts/api-types";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  useCreateModelConnection,
  useDetectModelServer,
  useUpdateModelConnection,
} from "@/query/mutations/useModelConfiguration";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import type {
  CredentialStatus,
  CredentialsBridge,
} from "../../../../../shared/desktop-runtime";
import { credentialTarget } from "../../../../../shared/desktop-runtime";
import {
  applyCredentialChanges,
  credentialFailureMessage,
} from "@/ui/settings/desktop-credential-state";

import {
  detectionMessage,
  keyWouldTravelInsecurely,
  modelConfigurationErrorMessage,
} from "./model-configuration-state";

type Draft = {
  preset: string;
  name: string;
  baseUrl: string;
  timeout: string;
  compatibility: Required<PyModelConnectionCompatibility>;
  /** Desktop: a new key to store; never prefilled. */
  key: string;
  removeKey: boolean;
  /** Self-hosted web: the environment variable holding the key. */
  envName: string;
};

const DEFAULT_COMPATIBILITY: Required<PyModelConnectionCompatibility> = {
  fold_developer_role: false,
  send_openai_extensions: true,
  send_stream_usage: true,
  strip_function_strict: false,
  reasoning_mode: "openai_effort",
};

const COMPATIBILITY_OPTIONS: ReadonlyArray<{
  key: Exclude<keyof PyModelConnectionCompatibility, "reasoning_mode">;
  label: string;
}> = [
  {
    key: "fold_developer_role",
    label: "Merge developer instructions into the system message",
  },
  { key: "send_openai_extensions", label: "Send OpenAI-only request fields" },
  { key: "send_stream_usage", label: "Request token usage while streaming" },
  { key: "strip_function_strict", label: "Remove strict flags from tools" },
];

function draftFromPreset(preset: PyModelConnectionPreset): Draft {
  return {
    preset: preset.id,
    name: preset.label,
    baseUrl: preset.default_base_url ?? "",
    timeout: String(preset.timeout_seconds),
    compatibility: { ...DEFAULT_COMPATIBILITY, ...preset.compatibility },
    key: "",
    removeKey: false,
    envName: preset.suggested_credential_env ?? "",
  };
}

function draftFromConnection(connection: PyModelConnection): Draft {
  return {
    preset: connection.preset,
    name: connection.name,
    baseUrl: connection.base_url ?? "",
    timeout:
      connection.timeout_seconds != null
        ? String(connection.timeout_seconds)
        : "",
    compatibility: { ...DEFAULT_COMPATIBILITY, ...connection.compatibility },
    key: "",
    removeKey: false,
    envName: connection.credential_env ?? "",
  };
}

/**
 * Delete a connection's saved desktop key, offering a retry on failure because
 * nothing else lists the key once the connection no longer names it.
 */
export async function deleteConnectionKey(
  bridge: CredentialsBridge,
  env: string,
): Promise<void> {
  await applyCredentialChanges(bridge, [{ connection: env }]).catch(() =>
    toast.error("The connection's saved key could not be deleted.", {
      action: {
        label: "Retry",
        onClick: () => void deleteConnectionKey(bridge, env),
      },
    }),
  );
}

/** Why a saved connection's key was not stored, from main's reported status. */
function keyFailureMessage(error: unknown, env: string | null): string {
  const statuses = (error as { statuses?: CredentialStatus[] }).statuses ?? [];
  const status = statuses.find((item) => credentialTarget(item) === env);
  const reason = status ? credentialFailureMessage(status) : null;
  return `The connection was saved, but its key was not stored.${reason ? ` ${reason}` : " Retry from Edit."}`;
}

/** Busy and validity state a connection form's footer needs. */
export type ModelConnectionFormState = { saving: boolean; valid: boolean };

/**
 * The fields for adding or editing a model connection; `footer` renders
 * inside the form, so its submit button saves. On desktop the key is stored
 * in the encrypted vault under the connection's managed variable, which
 * restarts local services and reloads the app; on self-hosted web the owner
 * names the environment variable that holds the key. A new connection to a
 * local server type can **Detect** whether one is running at its default
 * address.
 */
export function ModelConnectionForm({
  presets,
  connection,
  managedKeys,
  onSaved,
  onSavingChange,
  footer,
}: {
  /** At least one preset; a new connection starts from the first. */
  presets: readonly PyModelConnectionPreset[];
  connection?: PyModelConnection;
  /** Desktop with its embedded runtime: keys go to the encrypted vault. */
  managedKeys: boolean;
  onSaved: (connection: PyModelConnection) => void;
  onSavingChange?: (saving: boolean) => void;
  footer: (state: ModelConnectionFormState) => ReactNode;
}) {
  const formId = useId();
  const platform = useRuntimePlatform();
  const bridge =
    platform.kind === "desktop"
      ? platform.desktopBridge.credentials
      : undefined;
  const create = useCreateModelConnection();
  const update = useUpdateModelConnection();
  const detect = useDetectModelServer();
  const [draft, setDraft] = useState<Draft | null>(() =>
    connection
      ? draftFromConnection(connection)
      : presets[0]
        ? draftFromPreset(presets[0])
        : null,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSavingState] = useState(false);
  const [detection, setDetection] = useState<PyModelConnectionDetection | null>(
    null,
  );

  if (!draft) return null;
  const preset = presets.find((item) => item.id === draft.preset);
  const canDetect = !connection && Boolean(preset?.local);
  const savedManagedKey =
    Boolean(connection?.credential_env) &&
    connection?.credential_state === "configured";
  const sendsKey = managedKeys
    ? Boolean(draft.key.trim()) || (savedManagedKey && !draft.removeKey)
    : Boolean(draft.envName.trim());
  const insecure = sendsKey && keyWouldTravelInsecurely(draft.baseUrl);
  const timeout = draft.timeout.trim() ? Number(draft.timeout) : null;
  const valid =
    Boolean(draft.name.trim()) &&
    Boolean(draft.baseUrl.trim()) &&
    (timeout === null || (Number.isFinite(timeout) && timeout > 0));
  const change = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const setSaving = (next: boolean) => {
    setSavingState(next);
    onSavingChange?.(next);
  };

  const credential = (): PyModelConnectionCredential => {
    if (managedKeys) return sendsKey ? { mode: "managed" } : { mode: "none" };
    const env = draft.envName.trim();
    return env ? { mode: "env", env } : { mode: "none" };
  };

  /** Check the preset's default address on the server and fill it in when found. */
  const runDetect = async () => {
    setDetection(null);
    try {
      const result = await detect.mutateAsync({ presetId: draft.preset });
      setDetection(result);
      if (result.reachable) change({ baseUrl: result.base_url });
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
    }
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      preset: draft.preset,
      base_url: draft.baseUrl.trim(),
      credential: credential(),
      compatibility: draft.compatibility,
      timeout_seconds: timeout,
    };
    let saved: PyModelConnection;
    try {
      saved = connection
        ? await update.mutateAsync({ connectionId: connection.id, body })
        : await create.mutateAsync(body);
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
      setSaving(false);
      return;
    }
    const key = draft.key.trim();
    setDraft((current) => (current ? { ...current, key: "" } : current));
    // The connection no longer names its variable once the key is removed.
    const removedEnv = draft.removeKey ? connection?.credential_env : null;
    try {
      if (managedKeys && bridge) {
        // Changing a key restarts local services and replaces this window, so
        // nothing after this call is guaranteed to run.
        if (key && saved.credential_env)
          await applyCredentialChanges(bridge, [
            { connection: saved.credential_env, value: key },
          ]);
        else if (removedEnv) await deleteConnectionKey(bridge, removedEnv);
      }
      toast.success(connection ? "Connection saved." : "Connection added.");
      onSaved(saved);
    } catch (error) {
      toast.error(keyFailureMessage(error, saved.credential_env ?? null));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${formId}-preset`}>Server type</Label>
        <Select
          value={draft.preset}
          disabled={saving}
          onValueChange={(value) => {
            const next = presets.find((item) => item.id === value);
            if (!next) return;
            setDetection(null);
            // Editing keeps the owner's URL and key; a new connection
            // takes the preset's defaults.
            setDraft(
              connection
                ? { ...draft, preset: next.id }
                : draftFromPreset(next),
            );
          }}
        >
          <SelectTrigger id={`${formId}-preset`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${formId}-name`}>Name</Label>
        <Input
          id={`${formId}-name`}
          value={draft.name}
          maxLength={80}
          disabled={saving}
          onChange={(event) => change({ name: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${formId}-url`}>Base URL</Label>
        <div className="flex gap-2">
          <Input
            id={`${formId}-url`}
            value={draft.baseUrl}
            placeholder="http://127.0.0.1:11434/v1"
            inputMode="url"
            disabled={saving}
            onChange={(event) => {
              // A detected address no longer describes a hand-edited one.
              setDetection(null);
              change({ baseUrl: event.target.value });
            }}
          />
          {canDetect ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving || detect.isPending}
              onClick={() => void runDetect()}
            >
              {detect.isPending ? "Detecting…" : "Detect"}
            </Button>
          ) : null}
        </div>
        {detection ? (
          <p
            className={cn(
              "text-xs",
              detection.reachable
                ? "text-muted-foreground"
                : "text-destructive",
            )}
            role="status"
          >
            {detectionMessage(detection, preset?.label ?? "the server")}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          The server&apos;s OpenAI-compatible address, usually ending in /v1.
        </p>
      </div>
      {managedKeys ? (
        <div className="space-y-2">
          <Label htmlFor={`${formId}-key`}>
            API key{" "}
            <span className="text-muted-foreground font-normal">
              {preset?.expects_key ? "(required)" : "(optional)"}
            </span>
          </Label>
          <Input
            id={`${formId}-key`}
            type="password"
            autoComplete="off"
            value={draft.key}
            placeholder={
              savedManagedKey ? "Saved; enter a new key to replace it" : ""
            }
            disabled={saving}
            onChange={(event) =>
              change({ key: event.target.value, removeKey: false })
            }
          />
          {savedManagedKey ? (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={draft.removeKey}
                disabled={saving || Boolean(draft.key.trim())}
                onCheckedChange={(checked) =>
                  change({ removeKey: checked === true })
                }
              />
              Remove the saved key
            </label>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Encrypted on this computer and never shown again. Saving a key
            restarts local services and reloads the app; test models after it
            reloads.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`${formId}-env`}>
            Key environment variable{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </Label>
          <Input
            id={`${formId}-env`}
            value={draft.envName}
            placeholder={
              preset?.suggested_credential_env ?? "MY_SERVER_API_KEY"
            }
            autoCapitalize="characters"
            disabled={saving}
            onChange={(event) => change({ envName: event.target.value })}
          />
          <p className="text-muted-foreground text-xs">
            The server reads the key from this variable in the backend
            environment. Keys are never stored in the database.
            {connection?.credential_env
              ? connection.credential_state === "configured"
                ? " It is set."
                : " It is not set in the backend environment."
              : ""}
          </p>
        </div>
      )}
      {insecure ? (
        <p className="text-destructive text-xs" role="alert">
          This address uses plain http on another computer, so the key would
          cross the network unencrypted. Use https or a local server.
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={`${formId}-timeout`}>Request timeout (seconds)</Label>
        <Input
          id={`${formId}-timeout`}
          value={draft.timeout}
          inputMode="decimal"
          disabled={saving}
          onChange={(event) => change({ timeout: event.target.value })}
        />
        <p className="text-muted-foreground text-xs">
          Local servers may need longer while a model loads.
        </p>
      </div>
      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((value) => !value)}
        >
          {showAdvanced ? "Hide advanced options" : "Advanced options"}
        </Button>
        {showAdvanced ? (
          <div className="space-y-3">
            {COMPATIBILITY_OPTIONS.map((option) => (
              <label
                key={option.key}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={draft.compatibility[option.key]}
                  disabled={saving}
                  onCheckedChange={(checked) =>
                    change({
                      compatibility: {
                        ...draft.compatibility,
                        [option.key]: checked === true,
                      },
                    })
                  }
                />
                {option.label}
              </label>
            ))}
            <div className="space-y-2">
              <Label htmlFor={`${formId}-reasoning`}>Reasoning effort</Label>
              <Select
                value={draft.compatibility.reasoning_mode}
                disabled={saving}
                onValueChange={(value) =>
                  change({
                    compatibility: {
                      ...draft.compatibility,
                      reasoning_mode:
                        value as Draft["compatibility"]["reasoning_mode"],
                    },
                  })
                }
              >
                <SelectTrigger id={`${formId}-reasoning`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai_effort">
                    Send as OpenAI reasoning effort
                  </SelectItem>
                  <SelectItem value="deepseek_thinking">
                    Send as DeepSeek thinking
                  </SelectItem>
                  <SelectItem value="omit">Do not send</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </div>
      {footer({ saving, valid })}
    </form>
  );
}

/**
 * Edit a model connection in a dialog. The dialog stays open while a save,
 * including a desktop key change, is in flight.
 */
export function ModelConnectionDialog({
  open,
  onOpenChange,
  presets,
  connection,
  managedKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: readonly PyModelConnectionPreset[];
  connection: PyModelConnection;
  managedKeys: boolean;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {connection.name}</DialogTitle>
          <DialogDescription>
            An OpenAI-compatible server such as Ollama, LM Studio, llama.cpp or
            a cloud provider.
          </DialogDescription>
        </DialogHeader>
        <ModelConnectionForm
          presets={presets}
          connection={connection}
          managedKeys={managedKeys}
          onSaved={() => onOpenChange(false)}
          onSavingChange={setSaving}
          footer={({ saving: busy, valid }) => (
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
