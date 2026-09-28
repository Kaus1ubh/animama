import { useState, type ReactNode } from "react";
import { Info, Plus } from "lucide-react";
import { toast } from "sonner";

import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelConnectionPreset,
  PyModelUsage,
} from "@animama/runtime-contracts/api-types";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  useModelConnectionPresets,
  useModelConnections,
} from "@/query/hooks/useModelConfiguration";
import {
  useRemoveModel,
  useRemoveModelConnection,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";
import { useDesktopCredentialsAvailable } from "@/ui/settings/DesktopCredentialsPanel";

import {
  connectionServerTab,
  CUSTOM_TAB_PRESET_IDS,
  MODEL_SERVER_TABS,
  modelApiTag,
  modelConfigurationErrorMessage,
  modelInUseUsage,
  removalConsequences,
  removalUsageSummary,
  type ModelApiTag,
  type ModelServerTab,
} from "./model-configuration-state";
import {
  deleteConnectionKey,
  ModelConnectionDialog,
  ModelConnectionForm,
} from "./ModelConnectionDialog";
import { ModelInfoDialog } from "./ModelInfoDialog";
import { OwnerModelDialog } from "./OwnerModelDialog";

type Removal =
  | {
      kind: "connection";
      connection: PyModelConnection;
      usage: PyModelUsage | null;
    }
  | { kind: "model"; model: PyConfiguredModel; usage: PyModelUsage | null };

const KEY_STATE_LABELS: Record<PyModelConnection["credential_state"], string> =
  {
    configured: "Key set",
    missing: "Key missing",
    not_required: "No key",
  };

/** Subtle tag colors that read in light and dark themes. */
const TAG_CLASSES: Record<ModelApiTag, string> = {
  Responses: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Completions: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Embeddings: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

/**
 * App Settings → Models: fixed tabs per server type (OpenAI, the local
 * servers and Custom), each listing its connections with their models. A
 * local tab without a connection shows the connect form for its server; the
 * Custom tab adds DeepSeek, Hugging Face and custom-URL connections. Owner
 * connections can be edited and removed; each model row opens an Info modal
 * with its details, and the owner may add models to any connection,
 * including the built-in OpenAI one.
 */
export function ModelConnectionsSettings({ disabled }: { disabled: boolean }) {
  const presets = useModelConnectionPresets(true);
  const connections = useModelConnections(true);
  const removeConnection = useRemoveModelConnection();
  const removeModel = useRemoveModel();
  const platform = useRuntimePlatform();
  const managedKeys = useDesktopCredentialsAvailable();
  const [tab, setTab] = useState<ModelServerTab>("openai");
  const [connectionEditor, setConnectionEditor] =
    useState<PyModelConnection | null>(null);
  const [modelAdder, setModelAdder] = useState<PyModelConnection | null>(null);
  // Ids rather than rows, so the Info modal follows refetched data.
  const [info, setInfo] = useState<{
    connectionId: string;
    modelId: string;
  } | null>(null);
  const [addingCustom, setAddingCustom] = useState(false);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState(false);

  const all = connections.data ?? [];
  const templates = all
    .filter((connection) => connection.source === "builtin")
    .flatMap((connection) => connection.models ?? [])
    .filter(
      (model) => model.source === "builtin" && model.model_kind === "chat",
    );
  const infoConnection = info
    ? all.find((connection) => connection.id === info.connectionId)
    : undefined;
  const infoModel = infoConnection?.models?.find(
    (model) => model.id === info?.modelId,
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

  if (connections.isError)
    return (
      <p className="text-muted-foreground py-3 text-sm" role="status">
        Model connections could not be loaded.
      </p>
    );
  if (!connections.isSuccess) return null;

  /** Presets offered on a tab's connect form: its own, or Custom's choice. */
  const tabPresets = (id: ModelServerTab): PyModelConnectionPreset[] => {
    const ids = id === "custom" ? CUSTOM_TAB_PRESET_IDS : [id];
    return ids.flatMap(
      (presetId) =>
        presets.data?.filter((preset) => preset.id === presetId) ?? [],
    );
  };

  /** An inline connect form for a tab, with optional buttons beside Add. */
  const connectForm = (
    id: ModelServerTab,
    onSaved: () => void,
    extraButtons?: ReactNode,
  ) => {
    const choices = tabPresets(id);
    if (!choices.length) return null;
    return (
      <ModelConnectionForm
        key={id}
        presets={choices}
        managedKeys={managedKeys}
        onSaved={onSaved}
        footer={({ saving, valid }) => (
          <div className="flex justify-end gap-2">
            {extraButtons}
            <Button type="submit" disabled={disabled || !valid || saving}>
              {saving ? "Adding…" : "Add connection"}
            </Button>
          </div>
        )}
      />
    );
  };

  const connectionBlock = (connection: PyModelConnection) => {
    const models = connection.models ?? [];
    return (
      <section
        key={connection.id}
        aria-label={connection.name}
        className="space-y-3"
      >
        {connection.source === "builtin" ? (
          <p className="text-muted-foreground text-xs">
            Built-in. Uses the OpenAI key and base URL from API Keys or the
            environment.
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
                  startRemoval({ kind: "connection", connection, usage: null })
                }
              >
                Remove
              </Button>
            </div>
          </div>
        )}
        <ul className="divide-border/60 divide-y">
          {models.map((model) => {
            const tag = modelApiTag(model);
            return (
              <li key={model.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {model.model_label}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-sm px-2 py-0.5 text-[11px] font-medium",
                    TAG_CLASSES[tag],
                  )}
                >
                  {tag}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label={`Details for ${model.model_label} (${tag})`}
                  onClick={() =>
                    setInfo({ connectionId: connection.id, modelId: model.id })
                  }
                >
                  <Info className="size-4" aria-hidden />
                </Button>
              </li>
            );
          })}
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
            onClick={() => setModelAdder(connection)}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      </section>
    );
  };

  const tabContent = (id: ModelServerTab, label: string) => {
    const blocks = all.filter(
      (connection) => connectionServerTab(connection) === id,
    );
    const list = (
      <div className="divide-border space-y-4 divide-y [&>*:not(:first-child)]:pt-4">
        {blocks.map(connectionBlock)}
      </div>
    );
    if (id === "openai") return list;
    if (id !== "custom")
      return blocks.length ? (
        list
      ) : (
        <div className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Connect your {label} server, then add its models. Detect checks
            whether one is running at its default address.
          </p>
          {connectForm(id, () => undefined)}
        </div>
      );
    const showForm = addingCustom || blocks.length === 0;
    return (
      <div className="space-y-4">
        {blocks.length ? list : null}
        {showForm ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs">
              Connect DeepSeek, Hugging Face or another OpenAI-compatible
              server, then add its models.
            </p>
            {connectForm(
              id,
              () => setAddingCustom(false),
              blocks.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAddingCustom(false)}
                >
                  Cancel
                </Button>
              ) : null,
            )}
          </div>
        ) : (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !presets.isSuccess}
              onClick={() => setAddingCustom(true)}
            >
              <Plus className="size-4" aria-hidden />
              Add connection
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-w-0 py-3">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as ModelServerTab);
          setAddingCustom(false);
        }}
      >
        <TabsList variant="underline" aria-label="Model servers">
          {MODEL_SERVER_TABS.map(({ id, label }) => (
            <TabsTrigger
              key={id}
              value={id}
              variant="underline"
              className={underlineTabClassName(tab === id)}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {MODEL_SERVER_TABS.map(({ id, label }) => (
          <TabsContent key={id} value={id} className="mt-4">
            {tabContent(id, label)}
          </TabsContent>
        ))}
      </Tabs>
      {connectionEditor ? (
        <ModelConnectionDialog
          open
          onOpenChange={(open) => !open && setConnectionEditor(null)}
          // Keep the connection on its tab: offer only that tab's server types.
          presets={tabPresets(connectionServerTab(connectionEditor))}
          connection={connectionEditor}
          managedKeys={managedKeys}
        />
      ) : null}
      {modelAdder ? (
        <OwnerModelDialog
          open
          onOpenChange={(open) => !open && setModelAdder(null)}
          connection={modelAdder}
          templates={templates}
        />
      ) : null}
      {infoConnection && infoModel ? (
        <ModelInfoDialog
          onOpenChange={(open) => !open && setInfo(null)}
          connection={infoConnection}
          model={infoModel}
          templates={templates}
          disabled={disabled}
          onRemove={(model) => {
            setInfo(null);
            startRemoval({ kind: "model", model, usage: null });
          }}
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
