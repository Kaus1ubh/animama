import { useState } from "react";
import { toast } from "sonner";

import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelUsage,
} from "@animama/runtime-contracts/api-types";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  useModelConnectionPresets,
  useModelConnections,
} from "@/query/hooks/useModelConfiguration";
import {
  useRemoveModel,
  useRemoveModelConnection,
  useUpdateModel,
} from "@/query/mutations/useModelConfiguration";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Switch } from "@/ui/components/switch";
import { useDesktopCredentialsAvailable } from "@/ui/settings/DesktopCredentialsPanel";

import {
  modelConfigurationErrorMessage,
  modelInUseUsage,
  removalConsequences,
  removalUsageSummary,
} from "./model-configuration-state";
import {
  deleteConnectionKey,
  ModelConnectionDialog,
} from "./ModelConnectionDialog";
import { OwnerModelDialog } from "./OwnerModelDialog";

type Removal =
  | {
      kind: "connection";
      connection: PyModelConnection;
      usage: PyModelUsage | null;
    }
  | { kind: "model"; model: PyConfiguredModel; usage: PyModelUsage | null };

type ModelEditor = { connection: PyModelConnection; model?: PyConfiguredModel };

const KEY_STATE_LABELS: Record<PyModelConnection["credential_state"], string> =
  {
    configured: "Key set",
    missing: "Key missing",
    not_required: "No key",
  };

function apiLabel(model: PyConfiguredModel): string {
  return model.provider_type === "OpenAIResponsesHTTPAgent"
    ? "Responses API"
    : "Chat Completions API";
}

/** One-line facts about a model for its row in the connection list. */
function modelFacts(
  model: PyConfiguredModel,
  connection: PyModelConnection,
): string {
  const facts: string[] = [];
  // The built-in OpenAI connection lists some models once per API.
  if (connection.source === "builtin") facts.push(apiLabel(model));
  if (model.model_kind === "embedding")
    return [...facts, "Embedding model"].join(" · ");
  if (model.context_window_tokens != null)
    facts.push(`${model.context_window_tokens.toLocaleString()} tokens`);
  else if (model.source === "owner") facts.push("No context window set");
  facts.push(model.capabilities.supports_tools ? "tools" : "no tools");
  if (!model.allow_memory_writes) facts.push("no memory writes");
  return facts.join(" · ");
}

/**
 * App Settings → Models → Connections: every connection with its models.
 * Owner connections and models can be edited and removed; built-in OpenAI
 * models can only be hidden, but the owner may add models to that connection
 * (for example a newer OpenAI model).
 */
export function ModelConnectionsSettings({ disabled }: { disabled: boolean }) {
  const presets = useModelConnectionPresets(true);
  const connections = useModelConnections(true);
  const removeConnection = useRemoveModelConnection();
  const removeModel = useRemoveModel();
  const updateModel = useUpdateModel();
  const platform = useRuntimePlatform();
  const managedKeys = useDesktopCredentialsAvailable();
  const [connectionEditor, setConnectionEditor] = useState<{
    connection?: PyModelConnection;
  } | null>(null);
  const [modelEditor, setModelEditor] = useState<ModelEditor | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState(false);

  const all = connections.data ?? [];
  const templates = all
    .filter((connection) => connection.source === "builtin")
    .flatMap((connection) => connection.models ?? [])
    .filter(
      (model) => model.source === "builtin" && model.model_kind === "chat",
    );

  const credentials =
    platform.kind === "desktop"
      ? platform.desktopBridge.credentials
      : undefined;

  /**
   * The desktop key this app saved for a connection, if any. Deleting it
   * restarts local services and reloads the app.
   */
  const savedKey = (connection: PyModelConnection): string | null =>
    managedKeys &&
    connection.credential_state === "configured" &&
    connection.credential_env?.startsWith("ANIMAMA_CONNECTION_")
      ? connection.credential_env
      : null;

  /**
   * Without confirmation the server removes only an unused item and otherwise
   * refuses with its usage, which the dialog then shows.
   */
  const remove = async (target: Removal, confirm: boolean) => {
    try {
      if (target.kind === "connection")
        await removeConnection.mutateAsync({
          connectionId: target.connection.id,
          confirm,
        });
      else
        await removeModel.mutateAsync({
          modelProviderId: target.model.id,
          confirm,
        });
    } catch (error) {
      const usage = confirm ? null : modelInUseUsage(error);
      if (usage) setRemoval({ ...target, usage });
      else toast.error(modelConfigurationErrorMessage(error));
      return;
    }
    setRemoval(null);
    toast.success(
      target.kind === "connection" ? "Connection removed." : "Model removed.",
    );
    const env =
      target.kind === "connection" ? savedKey(target.connection) : null;
    if (env && credentials) await deleteConnectionKey(credentials, env);
  };

  /** A connection with a saved key always confirms first, because of the restart. */
  const startRemoval = (target: Removal) => {
    if (target.kind === "connection" && savedKey(target.connection))
      setRemoval(target);
    else void remove(target, false);
  };

  const confirmRemoval = async () => {
    if (!removal) return;
    setRemoving(true);
    // Confirm only once the usage has been shown.
    await remove(removal, removal.usage !== null);
    setRemoving(false);
  };

  const setHidden = (model: PyConfiguredModel, hidden: boolean) => {
    void updateModel
      .mutateAsync({ modelProviderId: model.id, body: { hidden } })
      .catch((error: unknown) =>
        toast.error(modelConfigurationErrorMessage(error)),
      );
  };

  if (connections.isError)
    return (
      <p className="text-muted-foreground py-3 text-sm" role="status">
        Model connections could not be loaded.
      </p>
    );

  return (
    <div className="space-y-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-prose text-sm">
          Connect local servers such as Ollama, LM Studio or llama.cpp, or cloud
          providers, then add the models you want to chat with.
        </p>
        <Button
          type="button"
          disabled={disabled || !presets.isSuccess}
          onClick={() => setConnectionEditor({})}
        >
          Add connection
        </Button>
      </div>
      {all.map((connection) => {
        const builtin = connection.source === "builtin";
        return (
          <section
            key={connection.id}
            className="border-border/60 space-y-3 rounded-xl border p-4"
            aria-label={connection.name}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold">
                  {connection.name}
                  {builtin ? (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      Built-in
                    </span>
                  ) : null}
                </h4>
                <p
                  className={cn(
                    "text-muted-foreground text-xs",
                    // URLs truncate; the built-in explanation wraps.
                    !builtin && "truncate",
                  )}
                >
                  {builtin
                    ? "Uses the OpenAI key and base URL from API Keys or the environment."
                    : `${connection.base_url ?? ""} · ${KEY_STATE_LABELS[connection.credential_state]}`}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setModelEditor({ connection })}
                >
                  Add model
                </Button>
                {!builtin ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled || !presets.isSuccess}
                      aria-label={`Edit ${connection.name}`}
                      onClick={() => setConnectionEditor({ connection })}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Remove ${connection.name}`}
                      onClick={() =>
                        startRemoval({
                          kind: "connection",
                          connection,
                          usage: null,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            <ul className="divide-border/60 divide-y">
              {(connection.models ?? []).map((model) => (
                <li
                  key={model.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{model.model_label}</div>
                    <div className="text-muted-foreground text-xs">
                      {modelFacts(model, connection)}
                    </div>
                  </div>
                  {model.source === "builtin" ? (
                    <label className="flex items-center gap-2 text-xs">
                      Show in model lists
                      <Switch
                        checked={!model.hidden}
                        disabled={disabled}
                        aria-label={`Show ${model.model_label} (${apiLabel(model)})`}
                        onCheckedChange={(checked) =>
                          setHidden(model, !checked)
                        }
                      />
                    </label>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={`Edit ${model.model_label}`}
                        onClick={() => setModelEditor({ connection, model })}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={`Remove ${model.model_label}`}
                        onClick={() =>
                          startRemoval({
                            kind: "model",
                            model,
                            usage: null,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {(connection.models ?? []).length === 0 ? (
                <li className="text-muted-foreground py-2 text-xs">
                  No models yet. Add one to chat with it.
                </li>
              ) : null}
            </ul>
          </section>
        );
      })}
      {connectionEditor ? (
        <ModelConnectionDialog
          open
          onOpenChange={(open) => !open && setConnectionEditor(null)}
          presets={presets.data ?? []}
          connection={connectionEditor.connection}
          managedKeys={managedKeys}
        />
      ) : null}
      {modelEditor ? (
        <OwnerModelDialog
          open
          onOpenChange={(open) => !open && setModelEditor(null)}
          connection={modelEditor.connection}
          model={modelEditor.model}
          templates={templates}
        />
      ) : null}
      <Dialog
        open={Boolean(removal)}
        onOpenChange={(open) => !open && !removing && setRemoval(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              Remove{" "}
              {removal?.kind === "connection"
                ? removal.connection.name
                : removal?.model.model_label}
              ?
            </DialogTitle>
            <DialogDescription>
              {[
                removal?.usage
                  ? `${removalUsageSummary(removal.usage)} ${removalConsequences(removal.usage)}`
                  : null,
                removal?.kind === "connection" && savedKey(removal.connection)
                  ? "Its saved key is deleted too, so Animama restarts its local services and reloads."
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={removing}
              onClick={() => setRemoval(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removing}
              onClick={() => void confirmRemoval()}
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
