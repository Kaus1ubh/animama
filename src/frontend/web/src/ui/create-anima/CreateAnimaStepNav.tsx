import type { TFunction } from "i18next";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CREATION_STEPS, type CreationStep } from "./createAnimaDraft";

/** Display text for one creator step: its progress label, heading and intro. */
export function creationStepText(
  t: TFunction<"create">,
  step: CreationStep,
): { label: string; heading: string; description: string | null } {
  switch (CREATION_STEPS[step]) {
    case "avatar":
      return {
        label: t("steps.avatar.label"),
        heading: t("steps.avatar.heading"),
        description: null,
      };
    case "voice":
      return {
        label: t("steps.voice.label"),
        heading: t("steps.voice.heading"),
        description: null,
      };
    case "identity":
      return {
        label: t("steps.identity.label"),
        heading: t("steps.identity.heading"),
        description: t("steps.identity.description"),
      };
    case "actions":
      return {
        label: t("steps.actions.label"),
        heading: t("steps.actions.heading"),
        description: t("steps.actions.description"),
      };
    case "review":
      return {
        label: t("steps.review.label"),
        heading: t("steps.review.heading"),
        description: null,
      };
  }
}

/** Ordered progress, not tabs: forward navigation always goes through validation. */
export function CreateAnimaStepNav({
  step,
  disabled,
  attention,
  onStep,
}: {
  step: number;
  disabled: boolean;
  attention: number[];
  onStep: (step: CreationStep) => void;
}) {
  const { t } = useTranslation("create");
  return (
    <nav aria-label={t("nav.label")}>
      <ol className="grid grid-cols-5 gap-0 border-b">
        {CREATION_STEPS.map((id, index) => {
          const { label } = creationStepText(t, index as CreationStep);
          const needsAttention = attention.includes(index);
          const completed = step > index && !needsAttention;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={step === index ? "step" : undefined}
                aria-label={
                  needsAttention
                    ? t("nav.needsAttention", { step: label })
                    : completed
                      ? t("nav.completed", { step: label })
                      : label
                }
                disabled={disabled}
                onClick={() => onStep(index as CreationStep)}
                className={cn(
                  "focus-visible:ring-ring flex w-full flex-col items-center gap-1.5 border-b-2 border-transparent px-1 py-3 text-center text-xs outline-none focus-visible:ring-2 disabled:opacity-50",
                  needsAttention
                    ? "border-destructive text-destructive font-semibold"
                    : completed
                      ? "border-primary font-semibold"
                      : step === index
                        ? "border-primary font-semibold"
                        : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs",
                    needsAttention
                      ? "border-destructive text-destructive"
                      : completed
                        ? "border-primary bg-primary/15 text-primary"
                        : step === index && "border-primary text-primary",
                  )}
                >
                  {completed ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
