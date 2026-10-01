import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelConnectionDetection,
  PyModelConnectionPreset,
} from "@animama/runtime-contracts/api-types";
import type { SetupModelLocation } from "@/app/local-runtime/setup-draft";
import {
  useModelConnectionPresets,
  useModelConnections,
  useModelRoles,
} from "@/query/hooks/useModelConfiguration";
import { useModelProviders } from "@/query/hooks/useModelProviders";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import {
  useCreateModelConnection,
  useDetectModelServer,
} from "@/query/mutations/useModelConfiguration";
import { Button } from "@/ui/components/button";
import { Label } from "@/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@/ui/components/radio-group";
import { Tabs, TabsContent } from "@/ui/components/tabs";
import {
  DesktopCredentialsPanel,
  useDesktopCredentialsAvailable,
  type DesktopCredentialsController,
} from "@/ui/settings/DesktopCredentialsPanel";
import { ModelConnectionForm } from "@/ui/settings/models/ModelConnectionDialog";
import { OwnerModelDialog } from "@/ui/settings/models/OwnerModelDialog";
import { ModelLocationTabsList } from "@/ui/settings/models/ModelLocationTabsList";
import {
  baseUrlHost,
  connectionLocation,
  connectionStatusText,
  MODEL_LOCATION_PROVIDERS,
  modelConfigurationErrorMessage,
  modelSettingsAvailability,
} from "@/ui/settings/models/model-configuration-state";

import {
  connectionForDetection,
  detectedModelsToAdd,
  openAiDefaultModel,
  ownerModelChoices,
  SETUP_LOCAL_PRESETS,
  type SetupModelChoice,
} from "./setup-state";

const TAG_CLASS =
  "bg-primary/10 text-primary rounded-sm px-1.5 py-0.5 text-[11px] font-medium";

/** A model being added in the add-model dialog, optionally prefilled. */
type ModelAdder = { connection: PyModelConnection; initialModelId?: string };

/** Whether a just-added model can be the Chat default, as the server requires. */
function canChat(model: PyConfiguredModel): boolean {
  return (
    model.model_kind === "chat" &&
    model.capabilities.supports_streaming &&
    model.context_window_tokens != null
  );
}

/**
 * Setup's AI step: where models run (Cloud | Local) and the model new Animas
 * chat with. Cloud recommends OpenAI with its key; other providers connect
 * with the same form as App Settings → Models. Local finds a running Ollama,
 * LM Studio or llama.cpp server and adds one of its models. A runtime that
 * does not let the owner configure models shows no choice.
 */
export function SetupAiStep({
  location,
  onLocationChange,
  chatModelId,
  onChatModelChange,
  credentialsController,
  onKeyPendingChange,
  onKeyBusyChange,
  onSetUpLater,
}: {
  location: SetupModelLocation;
  onLocationChange: (location: SetupModelLocation) => void;
  chatModelId: string | null;
  onChatModelChange: (id: string | null) => void;
  credentialsController: Ref<DesktopCredentialsController>;
  onKeyPendingChange: (count: number) => void;
  onKeyBusyChange: (busy: boolean) => void;
  /** Leaves the step without a model ("Set up later"). */
  onSetUpLater: () => void;
}) {
  const capabilities = useRuntimeCapabilities();
  const managedKeys = useDesktopCredentialsAvailable();
  const { modelConfiguration } = modelSettingsAvailability(capabilities.data);

  // Two places take keys: the OpenAI key panel and an open connect form for
  // another provider. The step reports them to setup as one source, so
  // leaving with either unsaved asks first, and either save counts as busy.
  const panel = useRef<DesktopCredentialsController>(null);
  const form = useRef<DesktopCredentialsController>(null);
  const [panelPending, setPanelPending] = useState(0);
  const [panelBusy, setPanelBusy] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const pending = panelPending + (formDirty ? 1 : 0);
  const busy = panelBusy || formSaving;
  useEffect(() => onKeyPendingChange(pending), [onKeyPendingChange, pending]);
  useEffect(() => onKeyBusyChange(busy), [busy, onKeyBusyChange]);
  useImperativeHandle(credentialsController, () => ({
    save: async () => {
      if (panelPending > 0 && !(await panel.current?.save())) return false;
      return formDirty ? ((await form.current?.save()) ?? false) : true;
    },
    discard: () => {
      panel.current?.discard();
      form.current?.discard();
    },
  }));
  const connectForm: ConnectFormKeys = {
    controllerRef: form,
    onKeyDirtyChange: setFormDirty,
    onSavingChange: setFormSaving,
  };

  const openAiKey = managedKeys ? (
    <DesktopCredentialsPanel
      providers={["openai"]}
      showTitle={false}
      description="Encrypted on this computer and never shown again."
      className="bg-transparent p-3"
      controllerRef={panel}
      onPendingChange={setPanelPending}
      onBusyChange={setPanelBusy}
    />
  ) : null;

  if (capabilities.isPending)
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Checking which models this installation offers…
      </p>
    );
  if (capabilities.isError)
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Models could not be loaded. You can skip this step and set them up later
        in App Settings → Models.
      </p>
    );
  if (!modelConfiguration)
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          This installation provides its own models, so there is nothing to
          choose here.
        </p>
        {openAiKey}
      </div>
    );
  return (
    <ModelChooser
      location={location}
      onLocationChange={onLocationChange}
      chatModelId={chatModelId}
      onChatModelChange={onChatModelChange}
      managedKeys={managedKeys}
      openAiKey={openAiKey}
      connectForm={connectForm}
      onSetUpLater={onSetUpLater}
    />
  );
}

/** How an inline connect form reports its typed key to the step. */
type ConnectFormKeys = {
  controllerRef: Ref<DesktopCredentialsController>;
  onKeyDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
};

function ModelChooser({
  location,
  onLocationChange,
  chatModelId,
  onChatModelChange,
  managedKeys,
  openAiKey,
  connectForm,
  onSetUpLater,
}: {
  location: SetupModelLocation;
  onLocationChange: (location: SetupModelLocation) => void;
  chatModelId: string | null;
  onChatModelChange: (id: string | null) => void;
  managedKeys: boolean;
  openAiKey: ReactNode;
  connectForm: ConnectFormKeys;
  onSetUpLater: () => void;
}) {
  const choiceHeadingId = useId();
  const connections = useModelConnections(true);
  const providers = useModelProviders();
  const roles = useModelRoles(true);
  const presets = useModelConnectionPresets(true);
  const [adder, setAdder] = useState<ModelAdder | null>(null);

  const allConnections = connections.data ?? [];
  const items = providers.data ?? [];
  const builtin = allConnections.find(
    (connection) => connection.source === "builtin",
  );
  const openAiReady = builtin?.credential_state === "configured";
  const systemDefaultId = roles.data?.roles.find(
    (role) => role.role === "chat",
  )?.model_provider_id;
  const openAi = openAiDefaultModel(items, allConnections, systemDefaultId);
  const choices: Record<SetupModelLocation, SetupModelChoice[]> = {
    cloud: ownerModelChoices(items, allConnections, "cloud"),
    local: ownerModelChoices(items, allConnections, "local"),
  };
  // Only judge a choice against settled lists, never mid-refetch.
  const settled =
    connections.isSuccess &&
    providers.isSuccess &&
    roles.isFetched &&
    !connections.isFetching &&
    !providers.isFetching;
  const templates = (builtin?.models ?? []).filter(
    (model) => model.source === "builtin" && model.model_kind === "chat",
  );

  // Saving the OpenAI key here completes the choice with OpenAI's default
  // model. A key that was already set chooses nothing: only explicit choices
  // in this setup become the Chat default.
  const openAiId = openAiReady ? (openAi?.id ?? null) : null;
  const wasReady = useRef<boolean | null>(null);
  useEffect(() => {
    if (!connections.isSuccess) return;
    if (wasReady.current === false && openAiId && chatModelId === null)
      onChatModelChange(openAiId);
    wasReady.current = openAiReady;
  }, [
    chatModelId,
    connections.isSuccess,
    onChatModelChange,
    openAiId,
    openAiReady,
  ]);

  // A choice that is no longer offered (removed, or its key removed) is dropped.
  const offered =
    chatModelId === null ||
    chatModelId === openAiId ||
    [...choices.cloud, ...choices.local].some(
      (item) => item.id === chatModelId,
    );
  useEffect(() => {
    if (settled && !offered) onChatModelChange(null);
  }, [offered, onChatModelChange, settled]);

  const defaultItem = items.find((item) => item.id === systemDefaultId);
  const systemDefault = defaultItem
    ? (defaultItem.model_label ?? defaultItem.model)
    : null;
  const chosenLabel =
    chatModelId === null
      ? null
      : chatModelId === openAiId && openAi
        ? `OpenAI (${openAi.model_label ?? openAi.model})`
        : [...choices.cloud, ...choices.local]
            .filter((item) => item.id === chatModelId)
            .map((item) => `${item.label} on ${item.connectionName}`)[0];

  const presetById = (id: string) =>
    presets.data?.find((preset) => preset.id === id);
  const openAdder = (next: ModelAdder) => setAdder(next);
  const radioChoices: Array<SetupModelChoice & { disabled?: boolean }> = [
    ...(location === "cloud" && openAi
      ? [
          {
            id: openAi.id,
            label: "Use OpenAI",
            connectionName: openAi.model_label ?? openAi.model,
            disabled: !openAiReady,
          },
        ]
      : []),
    ...choices[location],
  ];

  if (connections.isError || providers.isError)
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Models could not be loaded. You can skip this step and set them up later
        in App Settings → Models.
      </p>
    );

  return (
    <div className="space-y-5">
      <Tabs
        value={location}
        onValueChange={(value) => onLocationChange(value as SetupModelLocation)}
      >
        <ModelLocationTabsList active={location} />
        {/* Both panels stay mounted so a typed key or open form survives a tab switch. */}
        <TabsContent
          value="cloud"
          forceMount
          className="mt-4 space-y-4 data-[state=inactive]:hidden"
        >
          <section
            aria-labelledby={`${choiceHeadingId}-openai`}
            className="border-border/60 space-y-2 rounded-xl border p-4"
          >
            <h3
              id={`${choiceHeadingId}-openai`}
              className="flex flex-wrap items-center gap-2 text-sm font-semibold"
            >
              OpenAI <span className={TAG_CLASS}>Recommended</span>
            </h3>
            <p className="text-muted-foreground text-xs">
              Chat with OpenAI&apos;s models using your API key.
            </p>
            {managedKeys ? (
              openAiKey
            ) : (
              <p className="text-muted-foreground text-xs">
                {openAiReady
                  ? "Uses the OpenAI key configured on this server."
                  : "Set OPENAI_API_KEY on the server to use OpenAI."}
              </p>
            )}
          </section>
          <OtherCloudProviders
            connections={allConnections}
            presetById={presetById}
            managedKeys={managedKeys}
            connectForm={connectForm}
            onAddModel={(connection) => openAdder({ connection })}
          />
        </TabsContent>
        <TabsContent
          value="local"
          forceMount
          className="mt-4 space-y-4 data-[state=inactive]:hidden"
        >
          <LocalServers
            active={location === "local"}
            connections={allConnections}
            presetById={presetById}
            hasModels={choices.local.length > 0}
            onAddModel={openAdder}
            onSetUpLater={onSetUpLater}
          />
        </TabsContent>
      </Tabs>
      {radioChoices.length ? (
        <section aria-labelledby={choiceHeadingId} className="space-y-2">
          <h3 id={choiceHeadingId} className="text-sm font-semibold">
            Model for new Animas
          </h3>
          <RadioGroup
            aria-labelledby={choiceHeadingId}
            value={chatModelId ?? ""}
            onValueChange={(value) => onChatModelChange(value || null)}
            className="gap-1"
          >
            {radioChoices.map((choice) => (
              <div key={choice.id} className="flex items-center gap-2 py-1">
                <RadioGroupItem
                  id={`${choiceHeadingId}-${choice.id}`}
                  value={choice.id}
                  disabled={choice.disabled}
                />
                <Label
                  htmlFor={`${choiceHeadingId}-${choice.id}`}
                  className="min-w-0 flex-1 font-normal"
                >
                  <span className="text-sm">{choice.label}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {choice.connectionName}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
          {location === "cloud" && openAi && !openAiReady ? (
            <p className="text-muted-foreground text-xs">
              Save your OpenAI key to use OpenAI.
            </p>
          ) : null}
        </section>
      ) : null}
      <p className="text-sm" role="status">
        {chosenLabel
          ? `New Animas will chat with ${chosenLabel}.`
          : systemDefault
            ? `No model chosen; new Animas use the system default (${systemDefault}).`
            : "No model chosen yet. You can skip this step and set one up later."}
      </p>
      <p className="text-muted-foreground text-xs">
        You can change models later in App Settings → Models.
      </p>
      {adder ? (
        <OwnerModelDialog
          open
          onOpenChange={(open) => !open && setAdder(null)}
          connection={adder.connection}
          initialModelId={adder.initialModelId}
          templates={templates}
          onAdded={(model) => {
            if (canChat(model)) onChatModelChange(model.id);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * DeepSeek, Hugging Face, OpenRouter and custom services: connected ones
 * with an Add model action, then a connect form for the others. Connecting
 * opens the add-model dialog (with OpenRouter's searchable list).
 */
function OtherCloudProviders({
  connections,
  presetById,
  managedKeys,
  connectForm,
  onAddModel,
}: {
  connections: readonly PyModelConnection[];
  presetById: (id: string) => PyModelConnectionPreset | undefined;
  managedKeys: boolean;
  connectForm: ConnectFormKeys;
  onAddModel: (connection: PyModelConnection) => void;
}) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const connected = connections.filter(
    (connection) =>
      connection.source !== "builtin" &&
      connectionLocation(connection) === "cloud",
  );
  const entries = MODEL_LOCATION_PROVIDERS.cloud.filter(
    (entry) =>
      entry.presetId !== "openai" &&
      (entry.presetId === "custom" ||
        !connected.some((connection) => connection.preset === entry.presetId)),
  );
  return (
    <details
      className="border-border/60 rounded-xl border p-4"
      open={connected.length > 0 || connecting !== null}
    >
      <summary className="cursor-pointer text-sm font-semibold">
        Use another cloud provider
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground text-xs">
          DeepSeek, Hugging Face, OpenRouter or any OpenAI-compatible service.
        </p>
        {connected.map((connection) => (
          <ConnectionRow
            key={connection.id}
            connection={connection}
            detail={connectionStatusText(connection)}
            onAddModel={() => onAddModel(connection)}
          />
        ))}
        <ul className="divide-border/60 divide-y">
          {entries.map((entry) => {
            const preset = presetById(entry.presetId);
            const open = connecting === entry.id;
            return (
              <li key={entry.id} className="space-y-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{entry.label}</span>
                  {open ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!preset}
                      aria-label={`Connect ${entry.label}`}
                      onClick={() => setConnecting(entry.id)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
                {open && preset ? (
                  <ModelConnectionForm
                    presets={[preset]}
                    managedKeys={managedKeys}
                    {...connectForm}
                    baseUrlPlaceholder="https://api.example.com/v1"
                    onSaved={(saved) => {
                      setConnecting(null);
                      onAddModel(saved);
                    }}
                    footer={({ saving, valid }) => (
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => setConnecting(null)}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={!valid || saving}>
                          {saving ? "Connecting…" : "Connect"}
                        </Button>
                      </div>
                    )}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

/** A connected provider or server with its status and an Add model action. */
function ConnectionRow({
  connection,
  detail,
  onAddModel,
}: {
  connection: PyModelConnection;
  detail: string;
  onAddModel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm">{connection.name}</p>
        <p className="text-muted-foreground truncate text-xs">{detail}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Add model to ${connection.name}`}
        onClick={onAddModel}
      >
        <Plus className="size-4" aria-hidden />
        Add model
      </Button>
    </div>
  );
}

type Detection = {
  state: "idle" | "searching" | "done";
  found: PyModelConnectionDetection[];
};

/**
 * Local servers: looks once for Ollama, LM Studio and llama.cpp at their
 * default addresses when the tab opens, then lists each running server's
 * models to add. With nothing running it gives one line of guidance.
 */
function LocalServers({
  active,
  connections,
  presetById,
  hasModels,
  onAddModel,
  onSetUpLater,
}: {
  active: boolean;
  connections: readonly PyModelConnection[];
  presetById: (id: string) => PyModelConnectionPreset | undefined;
  hasModels: boolean;
  onAddModel: (adder: ModelAdder) => void;
  onSetUpLater: () => void;
}) {
  const detect = useDetectModelServer();
  const create = useCreateModelConnection();
  const [detection, setDetection] = useState<Detection>({
    state: "idle",
    found: [],
  });
  const [adding, setAdding] = useState<string | null>(null);

  const search = async () => {
    setDetection({ state: "searching", found: [] });
    const results = await Promise.allSettled(
      SETUP_LOCAL_PRESETS.map((presetId) => detect.mutateAsync({ presetId })),
    );
    setDetection({
      state: "done",
      found: results.flatMap((result) =>
        result.status === "fulfilled" && result.value.reachable
          ? [result.value]
          : [],
      ),
    });
  };
  const shouldSearch = active && detection.state === "idle";
  useEffect(() => {
    if (shouldSearch) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search once when shown
  }, [shouldSearch]);

  /** Connect to the server if needed, then add the model in the dialog. */
  const addDetected = async (
    found: PyModelConnectionDetection,
    model: string,
  ) => {
    const preset = presetById(found.preset);
    let connection = connectionForDetection(found, connections);
    setAdding(`${found.preset}:${model}`);
    try {
      connection ??= await create.mutateAsync({
        name: preset?.label ?? found.preset,
        preset: found.preset,
        base_url: found.base_url,
        credential: { mode: "none" },
        compatibility: preset?.compatibility ?? null,
        timeout_seconds: preset?.timeout_seconds ?? null,
      });
      onAddModel({ connection, initialModelId: model });
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
    } finally {
      setAdding(null);
    }
  };

  const others = connections.filter(
    (connection) =>
      connection.source !== "builtin" &&
      connectionLocation(connection) === "local" &&
      !detection.found.some(
        (found) => connectionForDetection(found, [connection]) !== undefined,
      ),
  );
  const nothing =
    detection.state === "done" &&
    detection.found.length === 0 &&
    others.length === 0 &&
    !hasModels;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Use a model server running on this computer.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={detection.state === "searching"}
          onClick={() => void search()}
        >
          {detection.state === "searching" ? "Searching…" : "Search again"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs" role="status">
        {detection.state === "searching"
          ? "Looking for Ollama, LM Studio and llama.cpp…"
          : detection.state === "done" && detection.found.length
            ? `Found ${detection.found.length === 1 ? "1 server" : `${detection.found.length} servers`}.`
            : ""}
      </p>
      {detection.found.map((found) => {
        const label = presetById(found.preset)?.label ?? found.preset;
        const toAdd = detectedModelsToAdd(found, connections);
        return (
          <section
            key={found.preset}
            aria-label={label}
            className="border-border/60 space-y-2 rounded-xl border p-4"
          >
            <div>
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="text-muted-foreground text-xs">
                Running at {baseUrlHost(found.base_url)}
              </p>
            </div>
            {toAdd.length ? (
              <ul className="divide-border/60 divide-y">
                {toAdd.map((model) => (
                  <li
                    key={model}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  >
                    <span className="min-w-0 truncate text-sm">{model}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={adding !== null}
                      aria-label={`Add ${model}`}
                      onClick={() => void addDetected(found, model)}
                    >
                      {adding === `${found.preset}:${model}`
                        ? "Adding…"
                        : "Add"}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">
                {found.models.length
                  ? "All of its models are added."
                  : `${label} lists no models. Download one in ${label}, then search again.`}
              </p>
            )}
          </section>
        );
      })}
      {others.map((connection) => (
        <ConnectionRow
          key={connection.id}
          connection={connection}
          detail={baseUrlHost(connection.base_url)}
          onAddModel={() => onAddModel({ connection })}
        />
      ))}
      {nothing ? (
        <div className="space-y-2">
          <p className="text-sm">
            No local server found. Install and start Ollama, LM Studio or
            llama.cpp, then search again.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-ml-2"
            onClick={onSetUpLater}
          >
            Set up later
          </Button>
        </div>
      ) : null}
    </div>
  );
}
