import { useEffect, useId, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelProbeReport,
} from "@animama/runtime-contracts/api-types";
import {
  useAddOwnerModel,
  useListAvailableModels,
  useProbeModel,
  useUpdateModel,
} from "@/query/mutations/useModelConfiguration";
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
import { Switch } from "@/ui/components/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";

import {
  DEFAULT_CAPABILITIES_DRAFT,
  capabilitiesFromProbe,
  draftFromOpenRouterModel,
  errorCategoryMessage,
  modelApiLabel,
  modelConfigurationErrorMessage,
  type OwnerCapabilitiesDraft,
} from "./model-configuration-state";
import { OpenRouterModelPicker } from "./OpenRouterModelPicker";

const NO_TEMPLATE = "__no_template__";
const RESPONSES = "OpenAIResponsesHTTPAgent";
const CHAT_COMPLETIONS = "OpenAIHTTPAgent";
const NO_STRUCTURED_OUTPUT = "none";
/** Example model ID for the empty Model ID field. */
const MODEL_ID_EXAMPLE = "qwen3:8b";
/** Example context window for the empty field. */
const CONTEXT_WINDOW_EXAMPLE = "8192";

type Draft = {
  kind: "chat" | "embedding";
  model: string;
  label: string;
  providerType: typeof RESPONSES | typeof CHAT_COMPLETIONS;
  templateId: string | null;
  capabilities: OwnerCapabilitiesDraft;
  reasoningEfforts: string[];
  contextWindow: string;
  allowMemoryWrites: boolean;
};

type CapabilityToggle = Exclude<
  keyof OwnerCapabilitiesDraft,
  "structured_output_transport"
>;

const CAPABILITY_TOGGLES: readonly CapabilityToggle[] = [
  "supports_streaming",
  "supports_tools",
  "tools_with_structured_output",
  "accepts_images",
];

/** The checkbox label for one capability the owner confirms. */
function capabilityLabel(
  t: TFunction<"models">,
  toggle: CapabilityToggle,
): string {
  switch (toggle) {
    case "supports_streaming":
      return t("ownerModel.capabilities.supportsStreaming");
    case "supports_tools":
      return t("ownerModel.capabilities.supportsTools");
    case "tools_with_structured_output":
      return t("ownerModel.capabilities.toolsWithStructuredOutput");
    case "accepts_images":
      return t("ownerModel.capabilities.acceptsImages");
    default: {
      // Every capability needs its own label.
      const unlabelled: never = toggle;
      return unlabelled;
    }
  }
}

function capabilitiesOf(model: PyConfiguredModel): OwnerCapabilitiesDraft {
  const transport = model.capabilities.structured_output_transport;
  return {
    accepts_images: model.capabilities.accepts.includes("image"),
    supports_streaming: model.capabilities.supports_streaming,
    supports_tools: model.capabilities.supports_tools,
    tools_with_structured_output:
      model.capabilities.tools_with_structured_output,
    structured_output_transport:
      transport === "json_schema" || transport === "json_object"
        ? transport
        : null,
  };
}

function initialDraft(
  connection: PyModelConnection,
  model: PyConfiguredModel | undefined,
  initialModelId = "",
): Draft {
  if (model)
    return {
      kind: model.model_kind,
      model: model.model,
      label: model.model_label === model.model ? "" : model.model_label,
      providerType:
        model.provider_type === RESPONSES ? RESPONSES : CHAT_COMPLETIONS,
      templateId: model.template_id ?? null,
      capabilities: capabilitiesOf(model),
      reasoningEfforts: model.capabilities.supported_reasoning_efforts ?? [],
      contextWindow:
        model.context_window_tokens != null
          ? String(model.context_window_tokens)
          : "",
      allowMemoryWrites: model.allow_memory_writes,
    };
  return {
    kind: "chat",
    model: initialModelId,
    label: "",
    // The app picks the API: built-in OpenAI chat models use Responses.
    providerType:
      connection.source === "builtin" ? RESPONSES : CHAT_COMPLETIONS,
    templateId: null,
    capabilities: DEFAULT_CAPABILITIES_DRAFT,
    reasoningEfforts: [],
    contextWindow: "",
    allowMemoryWrites: true,
  };
}

/**
 * Save a model's visibility at once. A hidden model stays in use wherever it
 * is already chosen.
 */
function useSetModelHidden(model: PyConfiguredModel) {
  const update = useUpdateModel();
  const setHidden = (hidden: boolean) =>
    void update
      .mutateAsync({ modelProviderId: model.id, body: { hidden } })
      .catch((error: unknown) =>
        toast.error(modelConfigurationErrorMessage(error)),
      );
  return { setHidden, pending: update.isPending };
}

/** "Show in model lists" for a model's details. */
export function ModelVisibilitySwitch({
  model,
  disabled,
}: {
  model: PyConfiguredModel;
  disabled?: boolean;
}) {
  const { t } = useTranslation("models");
  const { setHidden, pending } = useSetModelHidden(model);
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {t("ownerModel.showInLists")}
      <Switch
        checked={!model.hidden}
        disabled={disabled || pending}
        onCheckedChange={(checked) => setHidden(!checked)}
      />
    </label>
  );
}

/** A hidden model row's Show button, the inline form of "Show in model lists". */
export function ShowModelButton({
  model,
  disabled,
}: {
  model: PyConfiguredModel;
  disabled?: boolean;
}) {
  const { t } = useTranslation("models");
  const { setHidden, pending } = useSetModelHidden(model);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-8 shrink-0"
      disabled={disabled || pending}
      aria-label={t("ownerModel.showNamedInLists", {
        name: model.model_label,
      })}
      onClick={() => setHidden(false)}
    >
      {t("actions.show")}
    </Button>
  );
}

/** "API: Responses" for a chat model's details; the API appears nowhere else. */
function ModelApiLine({ model }: { model: PyConfiguredModel }) {
  const { t } = useTranslation("models");
  if (model.model_kind !== "chat") return null;
  return (
    <p className="text-muted-foreground text-sm">
      {t("ownerModel.api", { api: modelApiLabel(model) })}
    </p>
  );
}

/**
 * Add a model to a connection, or show an owner model's details for editing.
 * The owner can copy a built-in model's capabilities, or Test the model to
 * prefill them from the server's answers; the context window is always the
 * owner's to confirm. An existing model's details also offer "Show in model
 * lists" and Remove.
 */
export function OwnerModelDialog({
  open,
  onOpenChange,
  connection,
  model,
  templates,
  onRemove,
  onAdded,
  initialModelId,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: PyModelConnection;
  model?: PyConfiguredModel;
  /** Built-in chat models whose capabilities can be copied. */
  templates: readonly PyConfiguredModel[];
  /** Starts removing the model being edited; the caller confirms any usage. */
  onRemove?: (model: PyConfiguredModel) => void;
  /** Settings are busy elsewhere; nothing here may change. */
  disabled?: boolean;
  /** Called with a newly added model, e.g. so setup can choose it. */
  onAdded?: (model: PyConfiguredModel) => void;
  /** Prefills a new model's ID, e.g. one a detected server listed. */
  initialModelId?: string;
}) {
  const { t } = useTranslation("models");
  const formId = useId();
  const add = useAddOwnerModel();
  const update = useUpdateModel();
  const discover = useListAvailableModels();
  const probe = useProbeModel();
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(connection, model, initialModelId),
  );
  const [report, setReport] = useState<PyModelProbeReport | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset per opening or model only, so a refetch (for example after "Show
  // in model lists") keeps unsaved edits.
  const modelId = model?.id;
  useEffect(() => {
    if (!open) return;
    setDraft(initialDraft(connection, model, initialModelId));
    setReport(null);
    discover.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per opening only
  }, [open, connection.id, modelId, initialModelId]);

  const editing = Boolean(model);
  const isChat = draft.kind === "chat";
  const isBuiltinConnection = connection.source === "builtin";
  const contextWindow = draft.contextWindow.trim()
    ? Number(draft.contextWindow)
    : null;
  const contextValid =
    contextWindow === null
      ? !isChat
      : Number.isInteger(contextWindow) && contextWindow > 0;
  const valid = Boolean(draft.model.trim()) && contextValid;
  const busy = disabled || saving || probe.isPending;
  const change = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const chooseTemplate = (value: string) => {
    const template = templates.find((item) => item.id === value);
    if (!template) return change({ templateId: null });
    change({
      templateId: template.id,
      capabilities: capabilitiesOf(template),
      reasoningEfforts: template.capabilities.supported_reasoning_efforts ?? [],
      contextWindow:
        draft.contextWindow ||
        (template.context_window_tokens != null
          ? String(template.context_window_tokens)
          : ""),
    });
  };

  const runProbe = async () => {
    if (!draft.model.trim()) return;
    try {
      const result = await probe.mutateAsync({
        connectionId: connection.id,
        body: {
          model: draft.model.trim(),
          kind: draft.kind,
          provider_type: draft.providerType,
        },
      });
      setReport(result);
      setDraft((current) => ({
        ...current,
        capabilities: capabilitiesFromProbe(result, current.capabilities),
        contextWindow:
          result.context_window_tokens != null
            ? String(result.context_window_tokens)
            : current.contextWindow,
      }));
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
    }
  };

  const capabilities = () => ({
    ...draft.capabilities,
    supported_reasoning_efforts: draft.reasoningEfforts,
  });

  const save = async () => {
    if (!valid || busy) return;
    setSaving(true);
    try {
      if (model)
        await update.mutateAsync({
          modelProviderId: model.id,
          body: {
            label: draft.label.trim() || null,
            ...(isChat
              ? {
                  capabilities: capabilities(),
                  context_window_tokens: contextWindow,
                  allow_memory_writes: draft.allowMemoryWrites,
                }
              : {}),
          },
        });
      else {
        const added = await add.mutateAsync({
          connectionId: connection.id,
          body: {
            model: draft.model.trim(),
            label: draft.label.trim() || null,
            kind: draft.kind,
            provider_type: isBuiltinConnection ? draft.providerType : null,
            template_id: isChat ? draft.templateId : null,
            capabilities: isChat ? capabilities() : null,
            context_window_tokens: isChat ? contextWindow : null,
            allow_memory_writes: draft.allowMemoryWrites,
            probe_result: report ? { ...report } : null,
          },
        });
        onAdded?.(added);
      }
      toast.success(editing ? t("ownerModel.saved") : t("ownerModel.added"));
      onOpenChange(false);
    } catch (error) {
      toast.error(modelConfigurationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const discovered = discover.data ?? [];
  // OpenRouter lists hundreds of models; its public list makes them searchable.
  const showOpenRouterPicker =
    !editing && isChat && connection.preset === "openrouter";
  // Templates are built-in OpenAI models, so only the built-in connection
  // offers them, matched to the API the new model uses.
  const templateChoices = isBuiltinConnection
    ? templates.filter(
        (template) => template.provider_type === draft.providerType,
      )
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {model
              ? model.model_label
              : t("ownerModel.addTitle", { name: connection.name })}
          </DialogTitle>
          <DialogDescription>
            {model
              ? model.model_kind === "embedding"
                ? t("ownerModel.editDescription.embedding", {
                    connection: connection.name,
                  })
                : t("ownerModel.editDescription.chat", {
                    connection: connection.name,
                  })
              : t("ownerModel.addDescription")}
          </DialogDescription>
        </DialogHeader>
        {model ? <ModelApiLine model={model} /> : null}
        {model ? <ModelVisibilitySwitch model={model} disabled={busy} /> : null}
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {!editing ? (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-kind`}>{t("fields.kind")}</Label>
              <Select
                value={draft.kind}
                disabled={busy}
                onValueChange={(value) => {
                  setReport(null);
                  change({ kind: value as Draft["kind"], templateId: null });
                }}
              >
                <SelectTrigger id={`${formId}-kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">{t("modelKinds.chat")}</SelectItem>
                  <SelectItem value="embedding">
                    {t("modelKinds.embedding")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {showOpenRouterPicker ? (
            <OpenRouterModelPicker
              selectedId={draft.model}
              disabled={busy}
              onSelect={(choice) => {
                // A test of another model says nothing about this one.
                setReport(null);
                setDraft((current) => ({
                  ...current,
                  ...draftFromOpenRouterModel(choice, current.capabilities),
                }));
              }}
            />
          ) : null}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-model`}>{t("fields.modelId")}</Label>
            <div className="flex gap-2">
              <Input
                id={`${formId}-model`}
                value={draft.model}
                list={`${formId}-available`}
                placeholder={MODEL_ID_EXAMPLE}
                disabled={busy || editing}
                onChange={(event) => {
                  setReport(null);
                  change({ model: event.target.value });
                }}
              />
              {!editing ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || discover.isPending}
                  onClick={() =>
                    void discover
                      .mutateAsync({ connectionId: connection.id })
                      .catch((error: unknown) =>
                        toast.error(modelConfigurationErrorMessage(error)),
                      )
                  }
                >
                  {discover.isPending
                    ? t("ownerModel.listing")
                    : t("ownerModel.listModels")}
                </Button>
              ) : null}
            </div>
            <datalist id={`${formId}-available`}>
              {discovered.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            {discover.isSuccess ? (
              <p className="text-muted-foreground text-xs">
                {discovered.length
                  ? t("ownerModel.listed", { count: discovered.length })
                  : t("ownerModel.listedNone")}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-label`}>
              {t("ownerModel.displayName")}{" "}
              <span className="text-muted-foreground font-normal">
                {t("optional")}
              </span>
            </Label>
            <Input
              id={`${formId}-label`}
              value={draft.label}
              maxLength={120}
              disabled={busy}
              onChange={(event) => change({ label: event.target.value })}
            />
          </div>
          {isChat && !editing && templateChoices.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-template`}>
                {t("ownerModel.copyFrom")}
              </Label>
              <Select
                value={draft.templateId ?? NO_TEMPLATE}
                disabled={busy}
                onValueChange={chooseTemplate}
              >
                <SelectTrigger id={`${formId}-template`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>
                    {t("ownerModel.copyNothing")}
                  </SelectItem>
                  {templateChoices.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.model_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {t("ownerModel.copyFromHelp")}
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !draft.model.trim()}
              onClick={() => void runProbe()}
            >
              {probe.isPending
                ? t("actions.testing")
                : t("ownerModel.testModel")}
            </Button>
            <ProbeSummary report={report} />
          </div>
          {isChat ? (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  {t("fields.capabilities")}
                </legend>
                {CAPABILITY_TOGGLES.map((toggle) => (
                  <label
                    key={toggle}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={draft.capabilities[toggle]}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        change({
                          capabilities: {
                            ...draft.capabilities,
                            [toggle]: checked === true,
                          },
                        })
                      }
                    />
                    {capabilityLabel(t, toggle)}
                  </label>
                ))}
                <div className="space-y-2 pt-1">
                  <Label htmlFor={`${formId}-structured`}>
                    {t("fields.structuredOutput")}
                  </Label>
                  <Select
                    value={
                      draft.capabilities.structured_output_transport ??
                      NO_STRUCTURED_OUTPUT
                    }
                    disabled={busy}
                    onValueChange={(value) =>
                      change({
                        capabilities: {
                          ...draft.capabilities,
                          structured_output_transport:
                            value === NO_STRUCTURED_OUTPUT
                              ? null
                              : (value as "json_schema" | "json_object"),
                        },
                      })
                    }
                  >
                    <SelectTrigger
                      id={`${formId}-structured`}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="json_schema">
                        {t("structuredOutput.jsonSchema")}
                      </SelectItem>
                      <SelectItem value="json_object">
                        {t("structuredOutput.jsonObject")}
                      </SelectItem>
                      <SelectItem value={NO_STRUCTURED_OUTPUT}>
                        {t("structuredOutput.none")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-context`}>
                  {t("ownerModel.contextWindow")}
                </Label>
                <Input
                  id={`${formId}-context`}
                  value={draft.contextWindow}
                  inputMode="numeric"
                  placeholder={CONTEXT_WINDOW_EXAMPLE}
                  disabled={busy}
                  aria-invalid={!contextValid}
                  onChange={(event) =>
                    change({ contextWindow: event.target.value })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  {t("ownerModel.contextWindowHelp")}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.allowMemoryWrites}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    change({ allowMemoryWrites: checked === true })
                  }
                />
                {t("ownerModel.allowMemoryWrites")}
              </label>
            </>
          ) : null}
        </form>
        <DialogFooter>
          {model && onRemove ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive sm:mr-auto"
              disabled={busy}
              onClick={() => onRemove(model)}
            >
              {t("actions.remove")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t("actions.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={!valid || busy}>
            {saving
              ? t("actions.saving")
              : editing
                ? t("actions.save")
                : t("connections.addModel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A test step's name; a step this app does not know keeps the server's id. */
function stepLabel(t: TFunction<"models">, step: string): string {
  switch (step) {
    case "streaming":
      return t("probe.steps.streaming");
    case "structured_output":
      return t("probe.steps.structuredOutput");
    case "json_mode":
      return t("probe.steps.jsonMode");
    case "tool_calls":
      return t("probe.steps.toolCalls");
    case "tools_with_structured_output":
      return t("probe.steps.toolsWithStructuredOutput");
    case "available":
      return t("probe.steps.available");
    case "embeddings":
      return t("probe.steps.embeddings");
    default:
      return step;
  }
}

/** Results of a model test, one line per checked feature. */
export function ProbeSummary({
  report,
}: {
  report: PyModelProbeReport | null;
}) {
  const { t } = useTranslation("models");
  // The live region stays mounted so screen readers announce each result.
  return (
    <div role="status" aria-live="polite">
      {report ? (
        <ul className="space-y-1 text-xs" aria-label={t("probe.results")}>
          {report.steps.map((step) => (
            <li key={step.name}>
              <span
                className={step.ok ? "text-foreground" : "text-destructive"}
              >
                {step.ok
                  ? t("probe.passed", { step: stepLabel(t, step.name) })
                  : t("probe.failed", { step: stepLabel(t, step.name) })}
              </span>
              {!step.ok && step.category ? (
                <span className="text-muted-foreground">
                  {t("probe.failureReason", {
                    reason: errorCategoryMessage(step.category),
                  })}
                </span>
              ) : null}
            </li>
          ))}
          {report.context_window_tokens != null ? (
            <li className="text-muted-foreground">
              {t("probe.contextWindow", {
                tokens: report.context_window_tokens,
              })}
            </li>
          ) : null}
          {report.embedding_dimensions != null ? (
            <li className="text-muted-foreground">
              {t("probe.dimensions", {
                dimensions: report.embedding_dimensions,
              })}
            </li>
          ) : null}
          {(report.notes ?? []).map((note) => (
            <li key={note} className="text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
