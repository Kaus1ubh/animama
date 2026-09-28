import { useState } from "react";
import { Plus } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
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
  ModelConnectionForm,
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

/** Tab value for adding a connection; connection tabs use their ids. */
const ADD_TAB = "__add_connection__";

/**
 * App Settings → Models: one tab per connection (the built-in OpenAI
 * connection first) with its models, and a "+" tab that adds a connection.
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
  const [tab, setTab] = useState<string | null>(null);
  const [connectionEditor, setConnectionEditor] =
    useState<PyModelConnection | null>(null);
  const [modelEditor, setModelEditor] = useState<ModelEditor | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState(false);

  // The built-in OpenAI connection leads; owner connections follow in order.
  const all = [...(connections.data ?? [])].sort(
    (a, b) => Number(b.source === "builtin") - Number(a.source === "builtin"),
  );
  // Until a tab is chosen, or after its connection is removed, show OpenAI.
  const activeTab =
    tab !== null &&
    (tab === ADD_TAB || all.some((connection) => connection.id === tab))
      ? tab
      : (all[0]?.id ?? ADD_TAB);
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
    if (target.kind === "connection") setTab(null);
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
  if (!connections.isSuccess) return null;

  return (
    <div className="py-3">
      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList
          aria-label="Model connections"
          // Wraps instead of scrolling so every tab stays reachable on phones.
          className="h-auto w-full flex-wrap justify-start gap-1"
        >
          {all.map((connection) => (
            <TabsTrigger
              key={connection.id}
              value={connection.id}
              className="max-w-full"
            >
              <span className="truncate">{connection.name}</span>
            </TabsTrigger>
          ))}
          <TabsTrigger
            value={ADD_TAB}
            aria-label="Add connection"
            disabled={!presets.data?.length}
          >
            <Plus className="size-4" aria-hidden />
          </TabsTrigger>
        </TabsList>
        {all.map((connection) => {
          const builtin = connection.source === "builtin";
          const models = connection.models ?? [];
          return (
            <TabsContent
              key={connection.id}
              value={connection.id}
              className="mt-4 space-y-3"
            >
              {builtin ? (
                <p className="text-muted-foreground text-xs">
                  Built-in. Uses the OpenAI key and base URL from API Keys or
                  the environment.
                </p>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{connection.name}</h4>
                    <p className="text-muted-foreground truncate text-xs">
                      {`${connection.base_url ?? ""} · ${KEY_STATE_LABELS[connection.credential_state]}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled || !presets.isSuccess}
                      aria-label={`Edit ${connection.name}`}
                      onClick={() => setConnectionEditor(connection)}
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
                  </div>
                </div>
              )}
              <ul className="divide-border/60 divide-y">
                {models.map((model) => (
                  <li
                    key={model.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">
                        {model.model_label}
                      </div>
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
                {models.length === 0 ? (
                  <li className="text-muted-foreground py-2 text-xs">
                    No models yet. Add one to chat with it.
                  </li>
                ) : null}
              </ul>
              <div className="flex justify-center">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="rounded-full"
                  disabled={disabled}
                  aria-label={`Add model to ${connection.name}`}
                  onClick={() => setModelEditor({ connection })}
                >
                  <Plus className="size-4" aria-hidden />
                </Button>
              </div>
            </TabsContent>
          );
        })}
        <TabsContent value={ADD_TAB} className="mt-4 space-y-4">
          <p className="text-muted-foreground text-xs">
            Connect an OpenAI-compatible server such as Ollama, LM Studio,
            llama.cpp or a cloud provider, then add its models.
          </p>
          {presets.data?.length ? (
            <ModelConnectionForm
              presets={presets.data}
              managedKeys={managedKeys}
              onSaved={(saved) => setTab(saved.id)}
              footer={({ saving, valid }) => (
                <div className="flex justify-end">
                  <Button type="submit" disabled={disabled || !valid || saving}>
                    {saving ? "Adding…" : "Add connection"}
                  </Button>
                </div>
              )}
            />
          ) : null}
        </TabsContent>
      </Tabs>
      {connectionEditor ? (
        <ModelConnectionDialog
          open
          onOpenChange={(open) => !open && setConnectionEditor(null)}
          presets={presets.data ?? []}
          connection={connectionEditor}
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
