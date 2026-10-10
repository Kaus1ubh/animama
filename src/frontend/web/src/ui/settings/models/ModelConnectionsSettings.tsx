import { useId, useState } from "react";
import { Info, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelConnectionPreset,
  PyModelUsage,
  WebSearchCapability,
} from "@animama/runtime-contracts/api-types";
import { alternateModelIds, modelDisplayName } from "@/lib/chat/model-catalog";
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
import { Tabs, TabsContent } from "@/ui/components/tabs";
import {
  DesktopCredentialsPanel,
  useDesktopCredentialsAvailable,
} from "@/ui/settings/DesktopCredentialsPanel";

import {
  baseUrlHost,
  connectionLocation,
  connectionProviderEntry,
  connectionStatusText,
  defaultLocationProvider,
  locationProviderGroups,
  MODEL_LOCATION_TABS,
  modelCapabilityChips,
  modelConfigurationErrorCode,
  modelConfigurationErrorMessage,
  modelInUseUsage,
  modelLocationLabel,
  modelProviderPurpose,
  modelSettingsAvailability,
  removalConsequences,
  removalUsageSummary,
  type ConnectionReachability,
  type ModelLocation,
  type ModelProviderEntry,
  type ModelProviderGroup,
} from "./model-configuration-state";
import {
  deleteConnectionKey,
  ModelConnectionDialog,
  ModelConnectionForm,
} from "./ModelConnectionDialog";
import { ModelInfoDialog } from "./ModelInfoDialog";
import { ModelLocationTabsList } from "./ModelLocationTabsList";
import { ModelProviderTabsList } from "./ModelProviderTabsList";
import { OwnerModelDialog, ShowModelButton } from "./OwnerModelDialog";

type Removal =
  | {
      kind: "connection";
      connection: PyModelConnection;
      usage: PyModelUsage | null;
    }
  | { kind: "model"; model: PyConfiguredModel; usage: PyModelUsage | null };

const BASE_URL_PLACEHOLDER: Record<ModelLocation, string> = {
  cloud: "https://api.example.com/v1",
  local: "http://127.0.0.1:8080/v1",
};

const TAG_CLASS =
  "bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-medium";

/**
 * App Settings → Models connections: **Cloud** and **Local** tabs, each with
 * a row of provider tabs. A provider tab shows only that provider: its
 * connection card (status, Edit/Remove, models) when connected, otherwise
 * its connect form inline; Custom lists each custom server plus "Add a
 * custom server". The built-in OpenAI card carries the OpenAI key field on
 * desktop. Each model row shows capability chips and opens an Info modal;
 * hidden rows stay listed behind a toggle so they can be shown again.
 * Connecting stays on that provider's tab and opens the add-model dialog.
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
  const { t } = useTranslation("models");
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
  // The owner's provider tab per location; unset opens the default one.
  const [providerTab, setProviderTab] = useState<
    Partial<Record<ModelLocation, string>>
  >({});
  const [addingCustom, setAddingCustom] = useState<ModelLocation | null>(null);
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
      target.kind === "connection"
        ? t("connections.removed")
        : t("ownerModel.removed"),
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
        {t("connections.loadFailed")}
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

  /** Show a new connection's provider tab and add its first model. */
  const connected = (saved: PyModelConnection) => {
    // A custom server lands on the location its address implies.
    const location = connectionLocation(saved);
    setTab(location);
    setProviderTab((current) => ({
      ...current,
      [location]: connectionProviderEntry(saved).id,
    }));
    setAddingCustom(null);
    setModelAdder(saved);
  };

  const providerPanel = (
    location: ModelLocation,
    { entry, connections: items }: ModelProviderGroup<PyModelConnection>,
  ) => {
    const custom = entry.presetId === "custom";
    const preset = presetById(entry.presetId);
    const form = (onCancel?: () => void) =>
      preset ? (
        <div className="border-border/60 rounded-xl border p-4">
          <ModelConnectionForm
            presets={[preset]}
            managedKeys={managedKeys}
            baseUrlPlaceholder={BASE_URL_PLACEHOLDER[location]}
            onSaved={connected}
            footer={({ saving, valid }) => (
              <div className="flex justify-end gap-2">
                {onCancel ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={onCancel}
                  >
                    {t("actions.cancel")}
                  </Button>
                ) : null}
                <Button type="submit" disabled={disabled || !valid || saving}>
                  {saving
                    ? t("connections.connecting")
                    : t("connections.connect")}
                </Button>
              </div>
            )}
          />
        </div>
      ) : null;
    return (
      <>
        <p className="text-muted-foreground text-xs">
          {modelProviderPurpose(entry)}
        </p>
        {items.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            entry={entry}
            location={location}
            active={tab === location}
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
        {custom ? (
          addingCustom === location ? (
            form(() => setAddingCustom(null))
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || !preset}
              onClick={() => setAddingCustom(location)}
            >
              <Plus className="size-4" aria-hidden />
              {t("connections.addCustomServer")}
            </Button>
          )
        ) : items.length === 0 ? (
          form()
        ) : null}
      </>
    );
  };

  const tabContent = (location: ModelLocation) => {
    const groups = locationProviderGroups(all, location);
    const active = providerTab[location] ?? defaultLocationProvider(groups);
    return (
      <Tabs
        value={active}
        onValueChange={(value) =>
          setProviderTab((current) => ({ ...current, [location]: value }))
        }
      >
        <ModelProviderTabsList
          groups={groups}
          active={active}
          label={t("providers.tabsLabel", {
            location: modelLocationLabel(location),
          })}
        />
        {/* Every provider panel stays mounted so a half-filled connect form
            survives switching tabs. */}
        {groups.map((group) => (
          <TabsContent
            key={group.entry.id}
            value={group.entry.id}
            forceMount
            className="mt-4 space-y-4 data-[state=inactive]:hidden"
          >
            {providerPanel(location, group)}
          </TabsContent>
        ))}
      </Tabs>
    );
  };

  return (
    <div className="min-w-0 py-3">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ModelLocation)}
      >
        <ModelLocationTabsList active={tab} />
        {MODEL_LOCATION_TABS.map((id) => (
          <TabsContent
            key={id}
            value={id}
            forceMount
            className="mt-4 data-[state=inactive]:hidden"
          >
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
              {t("removal.title", {
                name:
                  (removal?.kind === "connection"
                    ? removal.connection.name
                    : removal?.model.model_label) ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {[
                removal?.usage
                  ? `${removalUsageSummary(removal.usage)} ${removalConsequences(removal.usage)}`
                  : null,
                removal?.kind === "connection" && savedKey(removal.connection)
                  ? t("removal.savedKeyDeleted")
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
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removing}
              onClick={() => void confirmRemoval()}
            >
              {removing ? t("actions.removing") : t("actions.remove")}
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
  active,
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
  /** Its location tab is showing; Local cards check reachability only then. */
  active: boolean;
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
  const { t } = useTranslation("models");
  const headingId = useId();
  const reachability = useConnectionReachability(
    connection.id,
    location === "local" && active,
  );
  const [showHidden, setShowHidden] = useState(false);
  const models = connection.models ?? [];
  const hiddenCount = models.filter((model) => model.hidden).length;
  const listed = showHidden ? models : models.filter((model) => !model.hidden);
  const alternates = alternateModelIds(listed);
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
                <span className="bg-primary/10 text-primary text-2xs rounded-sm px-1.5 py-0.5 font-medium">
                  {t("providers.recommended")}
                </span>
              ) : null}
            </h4>
            <p className="text-muted-foreground truncate text-xs">
              {/* Plain text: a live region per card would announce every
                  card whenever the tab opens. */}
              {host ? t("connections.detail", { host, status }) : status}
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
              aria-label={t("connections.editNamed", { name: connection.name })}
              onClick={onEdit}
            >
              {t("actions.edit")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={t("connections.removeNamed", {
                name: connection.name,
              })}
              onClick={onRemove}
            >
              {t("actions.remove")}
            </Button>
          </div>
        )}
      </div>
      {builtin ? <OpenAIKey managedKeys={managedKeys} /> : null}
      <ul
        aria-label={t("connections.modelsOf", { name: connection.name })}
        className="divide-border/60 divide-y"
      >
        {listed.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            search={search}
            alternate={alternates.has(model.id)}
            disabled={disabled}
            onInfo={() => onInfo(model)}
          />
        ))}
        {models.length === 0 ? (
          <li className="text-muted-foreground py-2 text-xs">
            {t("connections.noModels")}
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
              ? t("connections.hideHidden")
              : t("connections.showHidden", { count: hiddenCount })}
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={t("connections.addModelTo", { name: connection.name })}
          onClick={onAddModel}
        >
          <Plus className="size-4" aria-hidden />
          {t("connections.addModel")}
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
  const { t } = useTranslation("models");
  return managedKeys ? (
    <DesktopCredentialsPanel
      providers={["openai"]}
      showTitle={false}
      description={t("connections.openAiKey.managed")}
      className="bg-transparent p-3"
    />
  ) : (
    <p className="text-muted-foreground text-xs">
      {t("connections.openAiKey.server")}
    </p>
  );
}

/** A model's name, capability chips, hidden state and Info button. */
function ModelRow({
  model,
  search,
  alternate,
  disabled,
  onInfo,
}: {
  model: PyConfiguredModel;
  search: WebSearchCapability | null | undefined;
  /** Another listed row on this connection has the same name. */
  alternate: boolean;
  disabled: boolean;
  onInfo: () => void;
}) {
  const { t } = useTranslation("models");
  const chips = modelCapabilityChips(model, search);
  const name = modelDisplayName(model, alternate);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
      <span
        className={cn(
          "min-w-0 flex-1 basis-40 truncate text-sm",
          model.hidden && "text-muted-foreground",
        )}
      >
        {name}
      </span>
      {chips.length ? (
        <ul
          aria-label={t("fields.capabilities")}
          className="flex flex-wrap gap-1"
        >
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
            {t("modelRow.hidden")}
          </span>
          <ShowModelButton model={model} disabled={disabled} />
        </>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label={t("modelRow.details", { name })}
        onClick={onInfo}
      >
        <Info className="size-4" aria-hidden />
      </Button>
    </li>
  );
}
