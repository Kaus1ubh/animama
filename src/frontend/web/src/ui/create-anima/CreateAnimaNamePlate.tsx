import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Input } from "@/ui/components/input";
import { nameLength } from "./createAnimaDraft";

export function CreateAnimaNamePlate({
  value,
  limit,
  invalid,
  readOnly,
  onChange,
}: {
  value: string;
  limit: number;
  invalid: boolean;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("create");
  const count = nameLength(value);
  const missing = value.trim().length === 0;
  const errorMessage = missing
    ? t("draft.nameRequired")
    : t("draft.nameInvalid", { limit });
  return (
    <div
      className={cn(
        "bg-background/90 relative flex w-[min(92%,520px)] flex-col rounded-2xl border px-5 py-3 shadow-lg backdrop-blur-md",
        invalid &&
          "border-destructive ring-destructive/20 text-destructive ring-2",
      )}
    >
      <div className="flex w-full items-center gap-4">
        <label
          htmlFor="creation-display-name"
          className="text-muted-foreground shrink-0 text-sm font-semibold"
        >
          {t("namePlate.label")}
        </label>
        <Input
          id="creation-display-name"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          readOnly={readOnly}
          aria-invalid={invalid}
          aria-describedby={
            invalid
              ? "creation-name-count creation-name-error"
              : "creation-name-count"
          }
          autoComplete="off"
          placeholder={t("namePlate.placeholder")}
          className="h-10 min-w-0 flex-1 border-0 bg-transparent px-1 text-lg font-semibold shadow-none focus-visible:ring-0"
        />
        <Pencil
          className="text-muted-foreground size-5 shrink-0"
          aria-hidden="true"
        />
        <span
          id="creation-name-count"
          className={cn(
            "text-muted-foreground shrink-0 text-sm font-medium tabular-nums",
            count > limit && "text-destructive",
          )}
        >
          {t("namePlate.count", { current: count, limit })}
          <span className="sr-only"> {t("namePlate.characters")}</span>
        </span>
      </div>
      {invalid ? (
        <p
          id="creation-name-error"
          role="alert"
          className="mt-1 text-sm font-medium"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
