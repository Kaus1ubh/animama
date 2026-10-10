import type {
  PyConfiguredModel,
  PyModelConnection,
} from "@animama/runtime-contracts/api-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

import { modelApiLabel } from "./model-configuration-state";
import {
  EarlyCompactionSwitch,
  ModelVisibilitySwitch,
  OwnerModelDialog,
} from "./OwnerModelDialog";

const STRUCTURED_OUTPUT_LABELS: Record<string, string> = {
  json_schema: "JSON schema (strict)",
  json_object: "JSON mode",
};

const yesNo = (value: boolean | null | undefined) => (value ? "Yes" : "No");

/**
 * Label and value pairs describing a built-in model, in display order. The
 * API row is the only place the settings name a model's API.
 */
function builtinModelDetails(
  model: PyConfiguredModel,
): Array<[string, string]> {
  const { capabilities } = model;
  if (model.model_kind === "embedding")
    return [
      ["Model ID", model.model],
      ["Kind", "Embedding model"],
    ];
  const efforts = capabilities.supported_reasoning_efforts ?? [];
  return [
    ["Model ID", model.model],
    ["Kind", "Chat model"],
    ["API", modelApiLabel(model)],
    [
      "Context window",
      model.context_window_tokens != null
        ? `${model.context_window_tokens.toLocaleString()} tokens`
        : "Not set",
    ],
    ["Tool calls", yesNo(capabilities.supports_tools)],
    [
      "Structured output",
      STRUCTURED_OUTPUT_LABELS[
        capabilities.structured_output_transport ?? ""
      ] ?? "None",
    ],
    ["Tools with a schema", yesNo(capabilities.tools_with_structured_output)],
    [
      "Reasoning",
      efforts.length
        ? efforts.join(", ")
        : yesNo(capabilities.supports_reasoning),
    ],
    ["Streaming", yesNo(capabilities.supports_streaming)],
    ["Images", yesNo(capabilities.accepts.includes("image"))],
    ["Memory writes", model.allow_memory_writes ? "Allowed" : "Not allowed"],
  ];
}

/**
 * The Info modal behind a model row. Built-in models show read-only details;
 * owner models open the editable details form. Both offer "Show in model
 * lists" and, on models with a long-context price step, Compact early; owner
 * models can also be removed.
 */
export function ModelInfoDialog({
  onOpenChange,
  connection,
  model,
  templates,
  disabled,
  onRemove,
}: {
  onOpenChange: (open: boolean) => void;
  connection: PyModelConnection;
  model: PyConfiguredModel;
  /** Built-in chat models whose capabilities an owner model can copy. */
  templates: readonly PyConfiguredModel[];
  disabled: boolean;
  onRemove: (model: PyConfiguredModel) => void;
}) {
  if (model.source === "owner")
    return (
      <OwnerModelDialog
        open
        onOpenChange={onOpenChange}
        connection={connection}
        model={model}
        templates={templates}
        onRemove={onRemove}
        disabled={disabled}
      />
    );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{model.model_label}</DialogTitle>
          <DialogDescription>
            Built-in model on {connection.name}. Its details are fixed.
          </DialogDescription>
        </DialogHeader>
        <ModelVisibilitySwitch model={model} disabled={disabled} />
        <EarlyCompactionSwitch model={model} disabled={disabled} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {builtinModelDetails(model).map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
