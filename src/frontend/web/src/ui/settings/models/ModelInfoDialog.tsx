import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  PyConfiguredModel,
  PyModelConnection,
} from "@animama/runtime-contracts/api-types";
import { useFormatters, type LocaleFormatters } from "@animama/product-ui/i18n";
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

/** A built-in model's structured-output transport, worded. */
function structuredOutputLabel(
  t: TFunction<"models">,
  transport: string | null | undefined,
): string {
  if (transport === "json_schema") return t("structuredOutput.jsonSchema");
  if (transport === "json_object") return t("structuredOutput.jsonObject");
  return t("structuredOutput.none");
}

/**
 * Label and value pairs describing a built-in model, in display order. The
 * API row is the only place the settings name a model's API.
 */
function builtinModelDetails(
  t: TFunction<"models">,
  formatters: LocaleFormatters,
  model: PyConfiguredModel,
): Array<[string, string]> {
  const { capabilities } = model;
  const yesNo = (value: boolean | null | undefined) =>
    value ? t("info.yes") : t("info.no");
  if (model.model_kind === "embedding")
    return [
      [t("fields.modelId"), model.model],
      [t("fields.kind"), t("modelKinds.embedding")],
    ];
  // Reasoning effort names are API values, listed as sent.
  const efforts = capabilities.supported_reasoning_efforts ?? [];
  return [
    [t("fields.modelId"), model.model],
    [t("fields.kind"), t("modelKinds.chat")],
    [t("info.fields.api"), modelApiLabel(model)],
    [
      t("info.fields.contextWindow"),
      model.context_window_tokens != null
        ? t("info.tokens", { tokens: model.context_window_tokens })
        : t("info.notSet"),
    ],
    [t("info.fields.toolCalls"), yesNo(capabilities.supports_tools)],
    [
      t("fields.structuredOutput"),
      structuredOutputLabel(t, capabilities.structured_output_transport),
    ],
    [
      t("info.fields.toolsWithSchema"),
      yesNo(capabilities.tools_with_structured_output),
    ],
    [
      t("info.fields.reasoning"),
      efforts.length
        ? formatters.list(efforts, "unit")
        : yesNo(capabilities.supports_reasoning),
    ],
    [t("info.fields.streaming"), yesNo(capabilities.supports_streaming)],
    [t("info.fields.images"), yesNo(capabilities.accepts.includes("image"))],
    [
      t("info.fields.memoryWrites"),
      model.allow_memory_writes ? t("info.allowed") : t("info.notAllowed"),
    ],
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
  const { t } = useTranslation("models");
  const formatters = useFormatters();
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
            {t("info.builtinDescription", { name: connection.name })}
          </DialogDescription>
        </DialogHeader>
        <ModelVisibilitySwitch model={model} disabled={disabled} />
        <EarlyCompactionSwitch model={model} disabled={disabled} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {builtinModelDetails(t, formatters, model).map(([label, value]) => (
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
