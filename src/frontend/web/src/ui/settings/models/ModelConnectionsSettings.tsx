import { useId, useState } from "react";
import { Info, Plus } from "lucide-react";
import { toast } from "sonner";

import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelConnectionPreset,
  PyModelUsage,
  WebSearchCapability,
} from "@animama/runtime-contracts/api-types";
import { cn } from "@/lib/utils";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  useConnectionReachability,
  useModelConnectionPresets,
  useModelConnections,
} from "@/query/hooks/useModelConfiguration";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
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
import { ModelSelectorLogo } from "@/ui/components/model-selector";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";
import {
  DesktopCredentialsPanel,
  useDesktopCredentialsAvailable,
} from "@/ui/settings/DesktopCredentialsPanel";

import {
  baseUrlHost,
  connectionLocation,
  connectionProviderEntry,
  connectionStatusText,
  locationProviderGroups,
  MODEL_LOCATION_PROVIDERS,
  MODEL_LOCATION_TABS,
  modelCapabilityChips,
  modelConfigurationErrorCode,
  modelConfigurationErrorMessage,
  modelInUseUsage,
  modelSettingsAvailability,
  removalConsequences,
  removalUsageSummary,
  type ConnectionReachability,
  type ModelLocation,
  type ModelProviderEntry,
} from "./model-configuration-state";
import {
  deleteConnectionKey,
  ModelConnectionDialog,
  ModelConnectionForm,
} from "./ModelConnectionDialog";
import { ModelInfoDialog } from "./ModelInfoDialog";
import { OwnerModelDialog, ShowModelButton } from "./OwnerModelDialog";

type Removal =
  | {
      kind: "connection";
      connection: PyModelConnection;
      usage: PyModelUsage | null;
    }
  | { kind: "model"; model: PyConfiguredModel; usage: PyModelUsage | null };

/** One sentence of purpose per tab. */
const TAB_PURPOSE: Record<ModelLocation, string> = {
  cloud: "Chat with models from cloud providers using your API key.",
  local:
    "Chat with models running on this computer or your network; Detect finds a running server.",
};

const CUSTOM_HINT: Record<ModelLocation, string> = {
  cloud: "Any OpenAI-compatible service.",
  local: "A server on this computer or your network.",
};

const BASE_URL_PLACEHOLDER: Record<ModelLocation, string> = {
  cloud: "https://api.example.com/v1",
  local: "http://127.0.0.1:8080/v1",
};

const TAG_CLASS =
  "bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-medium";

/**
 * App Settings → Models connections: **Cloud** and **Local** tabs. Each lists
 * its connected providers first as cards with a status and their models, then
 * the providers not yet connected as "Add …" entries that open the connect
 * form inline. The built-in OpenAI card carries the OpenAI key field on
 * desktop. Each model row shows capability chips and opens an Info modal;
 * hidden rows stay listed behind a toggle so they can be shown again.
 *
 * Renders nothing unless the runtime allows model configuration (the hosted
 * composition keeps its fixed catalog).
 */
export function ModelConnectionsSettings({
  disabled,
  defaultTab = "cloud",
}: {
  disabled: boolean;
  defaultTab?: ModelLocation;
}) {
  const capabilities = useRuntimeCapabilities();
  const { modelConfiguration: enabled } = modelSettingsAvailability(
    capabilities.data,
  );
  const search = capabilities.data?.web_search;
  const presets = useModelConnectionPresets(enabled);
  const connections = useModelConnections(enabled);
  const removeConnection = useRemoveModelConnection();
  const removeModel = useRemoveModel();
  const platform = useRuntimePlatform();
  const managedKeys = useDesktopCredentialsAvailable();
  const [tab, setTab] = useState<ModelLocation>(defaultTab);
  const [adding, setAdding] = useState<string | null>(null);
  const [connectionEditor, setConnectionEditor] =
    useState<PyModelConnection | null>(null);
  const [modelAdder, setModelAdder] = useState<PyModelConnection | null>(null);
  // Ids rather than rows, so the Info modal follows refetched data.
  const [info, setInfo] = useState<{
    connectionId: string;
    modelId: string;
  } | null>(null);
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
   * The desktop key this app saved for a connection, if any. Removing the
   * connection deletes it too.
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

  /** A connection with a saved key always confirms first: the key cannot be recovered. */
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

  if (!enabled) return null;
  if (connections.isError)
    return (
      <p className="text-muted-foreground py-3 text-sm" role="status">
        Model connections could not be loaded.
      </p>
    );
  if (!connections.isSuccess) return null;

  const presetById = (id: string) =>
    presets.data?.find((preset) => preset.id === id);

  /**
   * Server types offered when editing: a cloud connection may switch among
   * the cloud types, as the old Custom tab allowed; a local one keeps its own.
   */
  const editPresets = (
    connection: PyModelConnection,
  ): PyModelConnectionPreset[] =>
    connectionLocation(connection) === "cloud"
      ? (presets.data ?? []).filter((preset) => !preset.local)
      : (presets.data ?? []).filter(
          (preset) => preset.id === connection.preset,
        );

  const tabContent = (location: ModelLocation) => {
    const groups = locationProviderGroups(all, location);
    const connected = groups.flatMap(({ entry, connections: items }) =>
      items.map((connection) => ({ entry, connection })),
    );
    // Unconnected providers in tab order, plus Custom (last), which can
    // always add another server.
    const connectedIds = new Set(connected.map(({ entry }) => entry.id));
    const addable = MODEL_LOCATION_PROVIDERS[location].filter(
      (entry) =>
        entry.presetId !== "openai" &&
        (entry.presetId === "custom" || !connectedIds.has(entry.id)),
    );
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-xs">{TAB_PURPOSE[location]}</p>
        {connected.map(({ entry, connection }) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            entry={entry}
            location={location}
            logo={
              connection.logo_provider ??
              presetById(connection.preset)?.logo_provider ??
              null
            }
            disabled={disabled}
            canEdit={presets.isSuccess}
            managedKeys={managedKeys}
            search={search}
            onEdit={() => setConnectionEditor(connection)}
            onRemove={() =>
              startRemoval({ kind: "connection", connection, usage: null })
            }
            onAddModel={() => setModelAdder(connection)}
            onInfo={(model) =>
              setInfo({ connectionId: connection.id, modelId: model.id })
            }
          />
        ))}
        {addable.length ? (
          <section aria-label="Add a provider" className="space-y-2">
            <h4 className="text-sm font-semibold">Add a provider</h4>
            <ul className="border-border/60 divide-border/60 divide-y rounded-xl border">
              {addable.map((entry) => (
                <AddProviderEntry
                  key={entry.id}
                  entry={entry}
                  location={location}
                  preset={presetById(entry.presetId)}
                  open={adding === entry.id}
                  disabled={disabled}
                  managedKeys={managedKeys}
                  onOpenChange={(open) => setAdding(open ? entry.id : null)}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  };

  return (
    <div className="min-w-0 py-3">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as ModelLocation);
          setAdding(null);
        }}
      >
        <TabsList variant="underline" aria-label="Where models run">
          {MODEL_LOCATION_TABS.map(({ id, label }) => (
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
        {MODEL_LOCATION_TABS.map(({ id }) => (
          <TabsContent key={id} value={id} className="mt-4">
            {tabContent(id)}
          </TabsContent>
        ))}
      </Tabs>
      {connectionEditor ? (
        <ModelConnectionDialog
          open
          onOpenChange={(open) => !open && setConnectionEditor(null)}
          presets={editPresets(connectionEditor)}
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
                  ? "Its saved key is deleted too and cannot be recovered."
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

/** A Local card's reachability from its model-listing query. */
function reachabilityOf(query: {
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
}): ConnectionReachability {
  if (query.isSuccess) return { state: "reachable" };
  if (query.isError)
    return {
      state: "failed",
      category: modelConfigurationErrorCode(query.error),
    };
  return { state: "checking" };
}

/**
 * One connected provider: name, status and actions, the OpenAI key on the
 * built-in card, then its models. Local cards list the server's models once
 * to report whether it is running.
 */
function ConnectionCard({
  connection,
  entry,
  location,
  logo,
  disabled,
  canEdit,
  managedKeys,
  search,
  onEdit,
  onRemove,
  onAddModel,
  onInfo,
}: {
  connection: PyModelConnection;
  entry: ModelProviderEntry;
  location: ModelLocation;
  logo: string | null;
  disabled: boolean;
  canEdit: boolean;
  managedKeys: boolean;
  search: WebSearchCapability | null | undefined;
  onEdit: () => void;
  onRemove: () => void;
  onAddModel: () => void;
  onInfo: (model: PyConfiguredModel) => void;
}) {
  const headingId = useId();
  const reachability = useConnectionReachability(
    connection.id,
    location === "local",
  );
  const [showHidden, setShowHidden] = useState(false);
  const models = connection.models ?? [];
  const hiddenCount = models.filter((model) => model.hidden).length;
  const listed = showHidden ? models : models.filter((model) => !model.hidden);
  const builtin = connection.source === "builtin";
  const status = connectionStatusText(
    connection,
    location === "local" ? reachabilityOf(reachability) : undefined,
  );
  // A custom cloud server's name may not say where it is.
  const host =
    location === "cloud" &&
    connectionProviderEntry(connection).presetId === "custom"
      ? baseUrlHost(connection.base_url)
      : null;

  return (
    <section
      aria-labelledby={headingId}
      className="border-border/60 space-y-3 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {logo ? (
            <ModelSelectorLogo provider={logo} className="size-5" />
          ) : null}
          <div className="min-w-0">
            <h4
              id={headingId}
              className="flex flex-wrap items-center gap-2 text-sm font-semibold"
            >
              {connection.name}
              {entry.recommended ? (
                <span className="bg-primary/10 text-primary rounded-sm px-1.5 py-0.5 text-[11px] font-medium">
                  Recommended
                </span>
              ) : null}
            </h4>
            <p className="text-muted-foreground truncate text-xs">
              {host ? `${host} · ` : null}
              <span role="status">{status}</span>
            </p>
          </div>
        </div>
        {builtin ? null : (
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || !canEdit}
              aria-label={`Edit ${connection.name}`}
              onClick={onEdit}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`Remove ${connection.name}`}
              onClick={onRemove}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
      {builtin ? <OpenAIKey managedKeys={managedKeys} /> : null}
      <ul
        aria-label={`${connection.name} models`}
        className="divide-border/60 divide-y"
      >
        {listed.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            search={search}
            disabled={disabled}
            onInfo={() => onInfo(model)}
          />
        ))}
        {models.length === 0 ? (
          <li className="text-muted-foreground py-2 text-xs">
            No models yet. Add one to chat with it.
          </li>
        ) : null}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hiddenCount ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-ml-2"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((value) => !value)}
          >
            {showHidden
              ? "Hide hidden models"
              : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? "model" : "models"}`}
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={`Add model to ${connection.name}`}
          onClick={onAddModel}
        >
          <Plus className="size-4" aria-hidden />
          Add model
        </Button>
      </div>
    </section>
  );
}

/**
 * The OpenAI key on the built-in card: the desktop vault field (the same
 * state as App Settings → API Keys), or where self-hosted web reads it.
 */
function OpenAIKey({ managedKeys }: { managedKeys: boolean }) {
  return managedKeys ? (
    <DesktopCredentialsPanel
      providers={["openai"]}
      showTitle={false}
      description="Encrypted on this computer and never shown again. Also in App Settings → API Keys."
      className="bg-transparent p-3"
    />
  ) : (
    <p className="text-muted-foreground text-xs">
      Uses the OpenAI key and base URL from the backend environment
      (OPENAI_API_KEY and OPENAI_BASE_URL).
    </p>
  );
}

/** A model's name, capability chips, hidden state and Info button. */
function ModelRow({
  model,
  search,
  disabled,
  onInfo,
}: {
  model: PyConfiguredModel;
  search: WebSearchCapability | null | undefined;
  disabled: boolean;
  onInfo: () => void;
}) {
  const chips = modelCapabilityChips(model, search);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
      <span
        className={cn(
          "min-w-0 flex-1 basis-40 truncate text-sm",
          model.hidden && "text-muted-foreground",
        )}
      >
        {model.model_label}
      </span>
      {chips.length ? (
        <ul aria-label="Capabilities" className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <li key={chip.id} className={TAG_CLASS} title={chip.description}>
              <span aria-hidden>{chip.label}</span>
              <span className="sr-only">{chip.description}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {model.hidden ? (
        <>
          <span
            className={cn(TAG_CLASS, "border-border border bg-transparent")}
          >
            Hidden
          </span>
          <ShowModelButton model={model} disabled={disabled} />
        </>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label={`Details for ${model.model_label}`}
        onClick={onInfo}
      >
        <Info className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

/** "Add …" for a provider, opening the connect form inline. */
function AddProviderEntry({
  entry,
  location,
  preset,
  open,
  disabled,
  managedKeys,
  onOpenChange,
}: {
  entry: ModelProviderEntry;
  location: ModelLocation;
  preset: PyModelConnectionPreset | undefined;
  open: boolean;
  disabled: boolean;
  managedKeys: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const custom = entry.presetId === "custom";
  const label = custom ? "Add a custom server" : `Add ${entry.label}`;
  return (
    <li className="space-y-3 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {preset?.logo_provider ? (
            <ModelSelectorLogo
              provider={preset.logo_provider}
              className="size-5"
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-sm">{custom ? "Custom" : entry.label}</p>
            {custom ? (
              <p className="text-muted-foreground text-xs">
                {CUSTOM_HINT[location]}
              </p>
            ) : null}
          </div>
        </div>
        {open ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !preset}
            aria-label={label}
            onClick={() => onOpenChange(true)}
          >
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        )}
      </div>
      {open && preset ? (
        <ModelConnectionForm
          presets={[preset]}
          managedKeys={managedKeys}
          baseUrlPlaceholder={BASE_URL_PLACEHOLDER[location]}
          onSaved={() => onOpenChange(false)}
          footer={({ saving, valid }) => (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || !valid || saving}>
                {saving ? "Adding…" : "Add connection"}
              </Button>
            </div>
          )}
        />
      ) : null}
    </li>
  );
}
