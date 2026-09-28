import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CREATION_STEPS, type CreationStep } from "./createAnimaDraft";

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
  return (
    <nav aria-label="Anima creation progress">
      <ol className="grid grid-cols-5 gap-0 border-b">
        {CREATION_STEPS.map((label, index) => {
          const needsAttention = attention.includes(index);
          const completed = step > index && !needsAttention;
          return (
            <li key={label}>
              <button
                type="button"
                aria-current={step === index ? "step" : undefined}
                aria-label={`${label}${needsAttention ? ", needs attention" : completed ? ", completed" : ""}`}
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
