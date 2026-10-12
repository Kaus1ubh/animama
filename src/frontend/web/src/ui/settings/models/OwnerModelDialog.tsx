import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelProbeReport,
} from "@animama/runtime-contracts/api-types";
import {
  ANTHROPIC_MESSAGES_PROVIDER_TYPE,
  modelProviderType,
  type ModelProviderType,
} from "@/lib/chat/model-catalog";
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
  draftAfterProbe,
  draftFromOpenRouterModel,
  errorCategoryMessage,
  modelApiLabel,
  modelConfigurationErrorMessage,
  ownerModelRules,
  type OwnerCapabilitiesDraft,
  type OwnerModelRules,
} from "./model-configuration-state";
import { OpenRouterModelPicker } from "./OpenRouterModelPicker";

const NO_TEMPLATE = "__no_template__";
const NO_STRUCTURED_OUTPUT = "none";

type Draft = {
  kind: "chat" | "embedding";
  model: string;
  label: string;
  /** The API the app picked for this connection; see `ownerModelRules`. */
  providerType: ModelProviderType;
  templateId: string | null;
  capabilities: OwnerCapabilitiesDraft;
  reasoningEfforts: string[];
  contextWindow: string;
  allowMemoryWrites: boolean;
};

const CAPABILITY_TOGGLES: ReadonlyArray<{
  key: Exclude<keyof OwnerCapabilitiesDraft, "structured_output_transport">;
  label: string;
}> = [
  { key: "supports_streaming", label: "Streams responses" },
  { key: "supports_tools", label: "Calls tools (memory, file search)" },
  {
    key: "tools_with_structured_output",
    label: "Combines tools with a response schema",
  },
  { key: "accepts_images", label: "Accepts images" },
];

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

/** A draft with a built-in model's capabilities copied in; the owner's context window is kept. */
function withTemplate(draft: Draft, template: PyConfiguredModel): Draft {
  return {
    ...draft,
    templateId: template.id,
    capabilities: capabilitiesOf(template),
    reasoningEfforts: template.capabilities.supported_reasoning_efforts ?? [],
    contextWindow:
      draft.contextWindow ||
      (template.context_window_tokens != null
        ? String(template.context_window_tokens)
        : ""),
  };
}

function initialDraft(
  rules: OwnerModelRules,
  model: PyConfiguredModel | undefined,
  initialModelId = "",
): Draft {
  if (model)
    return {
      kind: model.model_kind,
      model: model.model,
      label: model.model_label === model.model ? "" : model.model_label,
      providerType: modelProviderType(model.provider_type),
      templateId: model.template_id ?? null,
      capabilities: capabilitiesOf(model),
      reasoningEfforts: model.capabilities.supported_reasoning_efforts ?? [],
      contextWindow:
        model.context_window_tokens != null
          ? String(model.context_window_tokens)
          : "",
      allowMemoryWrites: model.allow_memory_writes,
    };
  const draft: Draft = {
    kind: "chat",
    model: initialModelId,
    label: "",
    providerType: rules.providerType,
    templateId: null,
    capabilities: DEFAULT_CAPABILITIES_DRAFT,
    reasoningEfforts: [],
    contextWindow: "",
    allowMemoryWrites: true,
  };
  // Choosing the Anthropic connection starts from Claude Haiku 5.5.
  const preselected = rules.templates.find(
    (template) => template.id === rules.defaultTemplateId,
  );
  return preselected ? withTemplate(draft, preselected) : draft;
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
  const { setHidden, pending } = useSetModelHidden(model);
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      Show in model lists
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
  const { setHidden, pending } = useSetModelHidden(model);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-8 shrink-0"
      disabled={disabled || pending}
      aria-label={`Show ${model.model_label} in model lists`}
      onClick={() => setHidden(false)}
    >
      Show
    </Button>
  );
}

/**
 * **Compact early** for a model with a long-context price step (the server
 * reports `early_compaction` as null on every other model). Saves at once.
 */
export function EarlyCompactionSwitch({
  model,
  disabled,
}: {
  model: PyConfiguredModel;
  disabled?: boolean;
}) {
  const update = useUpdateModel();
  const descriptionId = useId();
  if (model.early_compaction == null) return null;
  const setEarlyCompaction = (early_compaction: boolean) =>
    void update
      .mutateAsync({ modelProviderId: model.id, body: { early_compaction } })
      .catch((error: unknown) =>
        toast.error(modelConfigurationErrorMessage(error)),
      );
  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-3 text-sm">
        Compact early
        <Switch
          checked={model.early_compaction}
          disabled={disabled || update.isPending}
          aria-describedby={descriptionId}
          onCheckedChange={setEarlyCompaction}
        />
      </label>
      <p id={descriptionId} className="text-muted-foreground text-xs">
        Summarizes earlier conversation before prompts reach the higher
        long-context price (at 90,000 tokens on Claude Haiku 5.5). Off waits
        until 150,000 tokens, keeping more word for word at the higher price.
      </p>
    </div>
  );
}

/** "API: Responses" for a chat model's details; the API appears nowhere else. */
function ModelApiLine({ model }: { model: PyConfiguredModel }) {
  if (model.model_kind !== "chat") return null;
  return (
    <p className="text-muted-foreground text-sm">API: {modelApiLabel(model)}</p>
  );
}

/**
 * Add a model to a connection, or show an owner model's details for editing.
 * The owner can copy a built-in model's capabilities, or Test the model to
 * prefill them from the server's answers; the context window is always the
 * owner's to confirm. On the Anthropic connection the API is fixed, Claude
 * Haiku 5.5 is preselected as the template and Test reads Anthropic's Models
 * API. An existing model's details also offer "Show in model lists", Compact
 * early where it applies, and Remove.
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
  const formId = useId();
  const add = useAddOwnerModel();
  const update = useUpdateModel();
  const discover = useListAvailableModels();
  const probe = useProbeModel();
  const rules = ownerModelRules(connection, templates);
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(rules, model, initialModelId),
  );
  const [report, setReport] = useState<PyModelProbeReport | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset per opening or model only, so a refetch (for example after "Show
  // in model lists") keeps unsaved edits.
  const modelId = model?.id;
  useEffect(() => {
    if (!open) return;
    setDraft(initialDraft(rules, model, initialModelId));
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
    const template = rules.templates.find((item) => item.id === value);
    if (!template) return change({ templateId: null });
    setDraft((current) => withTemplate(current, template));
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
      setDraft((current) => draftAfterProbe(connection, current, result));
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
      toast.success(editing ? "Model saved." : "Model added.");
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
  // Only built-in connections offer templates, matched to the API they use.
  const templateChoices = rules.templates;
  const anthropic = rules.providerType === ANTHROPIC_MESSAGES_PROVIDER_TYPE;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {model ? model.model_label : `Add a model to ${connection.name}`}
          </DialogTitle>
          <DialogDescription>
            {model
              ? `${model.model_kind === "embedding" ? "Embedding model" : "Chat model"} on ${connection.name}. Change its details, then save.`
              : "Test the model to check what it supports, then confirm its capabilities and context window."}
          </DialogDescription>
        </DialogHeader>
        {model ? <ModelApiLine model={model} /> : null}
        {model ? <ModelVisibilitySwitch model={model} disabled={busy} /> : null}
        {model ? <EarlyCompactionSwitch model={model} disabled={busy} /> : null}
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {!editing && rules.embeddings ? (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-kind`}>Kind</Label>
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
                  <SelectItem value="chat">Chat model</SelectItem>
                  <SelectItem value="embedding">Embedding model</SelectItem>
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
            <Label htmlFor={`${formId}-model`}>Model ID</Label>
            <div className="flex gap-2">
              <Input
                id={`${formId}-model`}
                value={draft.model}
                list={`${formId}-available`}
                placeholder={anthropic ? "claude-sonnet-5-5" : "qwen3:8b"}
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
                  {discover.isPending ? "Listing…" : "List models"}
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
                  ? `${discovered.length} ${discovered.length === 1 ? "model" : "models"} found; choose one or type an ID.`
                  : "The server listed no models; type the model ID."}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-label`}>
              Display name{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
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
                Copy capabilities from
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
                    Nothing (set them below)
                  </SelectItem>
                  {templateChoices.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.model_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Useful for a newer version of a built-in model.
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
              {probe.isPending ? "Testing…" : "Test model"}
            </Button>
            <ProbeSummary report={report} />
          </div>
          {isChat ? (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Capabilities</legend>
                {CAPABILITY_TOGGLES.map((toggle) => (
                  <label
                    key={toggle.key}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={draft.capabilities[toggle.key]}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        change({
                          capabilities: {
                            ...draft.capabilities,
                            [toggle.key]: checked === true,
                          },
                        })
                      }
                    />
                    {toggle.label}
                  </label>
                ))}
                <div className="space-y-2 pt-1">
                  <Label htmlFor={`${formId}-structured`}>
                    Structured output
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
                        JSON schema (strict)
                      </SelectItem>
                      {rules.jsonMode ? (
                        <SelectItem value="json_object">JSON mode</SelectItem>
                      ) : null}
                      <SelectItem value={NO_STRUCTURED_OUTPUT}>None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-context`}>
                  Context window (tokens)
                </Label>
                <Input
                  id={`${formId}-context`}
                  value={draft.contextWindow}
                  inputMode="numeric"
                  placeholder="8192"
                  disabled={busy}
                  aria-invalid={!contextValid}
                  onChange={(event) =>
                    change({ contextWindow: event.target.value })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  {anthropic
                    ? "Required. Test the model to fill in the window Anthropic publishes for it; long chats are summarized to fit."
                    : "Required. Use the context size the server loads the model with (for example Ollama's num_ctx or llama.cpp's -c), not the model's maximum; long chats are summarized to fit."}
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
                Allow this model to write memories
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
              Remove
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!valid || busy}>
            {saving ? "Saving…" : editing ? "Save" : "Add model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STEP_LABELS: Record<string, string> = {
  streaming: "Streaming",
  structured_output: "JSON schema",
  json_mode: "JSON mode",
  tool_calls: "Tool calls",
  tools_with_structured_output: "Tools with a schema",
  available: "Model available",
  embeddings: "Embeddings",
};

/** Results of a model test, one line per checked feature. */
export function ProbeSummary({
  report,
}: {
  report: PyModelProbeReport | null;
}) {
  // The live region stays mounted so screen readers announce each result.
  return (
    <div role="status" aria-live="polite">
      {report ? (
        <ul className="space-y-1 text-xs" aria-label="Test results">
          {report.steps.map((step) => (
            <li key={step.name}>
              <span
                className={step.ok ? "text-foreground" : "text-destructive"}
              >
                {step.ok ? "✓" : "✗"} {STEP_LABELS[step.name] ?? step.name}
              </span>
              {!step.ok && step.category ? (
                <span className="text-muted-foreground">
                  {" "}
                  — {errorCategoryMessage(step.category)}
                </span>
              ) : null}
            </li>
          ))}
          {report.context_window_tokens != null ? (
            <li className="text-muted-foreground">
              The server reports a context window of{" "}
              {report.context_window_tokens} tokens.
            </li>
          ) : null}
          {report.embedding_dimensions != null ? (
            <li className="text-muted-foreground">
              Vectors have {report.embedding_dimensions} dimensions.
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
