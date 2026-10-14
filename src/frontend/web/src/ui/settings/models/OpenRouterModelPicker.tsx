import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PyOpenRouterModel } from "@animama/runtime-contracts/api-types";
import { cn } from "@/lib/utils";
import { useOpenRouterModels } from "@/query/hooks/useModelConfiguration";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import { Switch } from "@/ui/components/switch";

import {
  filterOpenRouterModels,
  formatContextWindow,
  openRouterModelsErrorMessage,
} from "./model-configuration-state";

/** Rows rendered at once; a search narrows longer lists. */
const MAX_SHOWN = 100;

/**
 * Search OpenRouter's public model list and pick a model to prefill the
 * add-model form. "Tool calling only" starts on, because Animas need tools
 * for memory and file search. When the list cannot be loaded, the owner types
 * the model ID in the form instead.
 */
export function OpenRouterModelPicker({
  selectedId,
  disabled,
  onSelect,
}: {
  selectedId: string;
  disabled?: boolean;
  onSelect: (model: PyOpenRouterModel) => void;
}) {
  const { t } = useTranslation("models");
  const id = useId();
  const models = useOpenRouterModels(true);
  const [query, setQuery] = useState("");
  const [toolsOnly, setToolsOnly] = useState(true);
  const all = models.data ?? [];
  const matches = filterOpenRouterModels(all, { query, toolsOnly });
  const shown = matches.slice(0, MAX_SHOWN);

  // Announced: loading, failure and an empty result. The running count is
  // plain text, so typing a search does not announce every keystroke.
  const announcement = models.isError
    ? openRouterModelsErrorMessage(models.error)
    : !models.isSuccess
      ? t("openRouter.loading")
      : matches.length === 0
        ? t("openRouter.noMatches")
        : "";
  const count =
    models.isSuccess && matches.length > 0
      ? matches.length > MAX_SHOWN
        ? t("openRouter.showingFirst", {
            shown: MAX_SHOWN,
            total: matches.length,
          })
        : t("openRouter.found", { count: matches.length })
      : null;

  return (
    <div className="border-border/60 space-y-3 rounded-lg border p-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-search`}>{t("openRouter.find")}</Label>
        <Input
          id={`${id}-search`}
          type="search"
          value={query}
          placeholder={t("openRouter.searchPlaceholder")}
          autoComplete="off"
          disabled={disabled || !models.isSuccess}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        {t("openRouter.toolsOnly")}
        <Switch
          checked={toolsOnly}
          disabled={disabled || !models.isSuccess}
          onCheckedChange={setToolsOnly}
        />
      </label>
      {/* The live region stays mounted and in the accessibility tree (sr-only
          while empty, never display:none) so each change is announced. */}
      <p
        className={cn(
          announcement ? "text-xs" : "sr-only",
          models.isError ? "text-destructive" : "text-muted-foreground",
        )}
        role="status"
      >
        {announcement}
      </p>
      {count ? <p className="text-muted-foreground text-xs">{count}</p> : null}
      {shown.length ? (
        <ul
          aria-label={t("openRouter.listLabel")}
          className="divide-border/60 max-h-56 divide-y overflow-y-auto"
        >
          {shown.map((model) => {
            const selected = model.id === selectedId;
            return (
              <li key={model.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  className={cn(
                    "hover:bg-muted/60 focus-visible:ring-ring w-full rounded-sm px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none",
                    selected && "bg-primary/10",
                  )}
                  onClick={() => onSelect(model)}
                >
                  <span className="block truncate text-sm">{model.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {[
                      model.id,
                      model.context_length != null
                        ? formatContextWindow(model.context_length)
                        : null,
                      model.supports_tools ? t("chips.tools.label") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
