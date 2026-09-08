import { useId } from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/ui/components/input";
import { CreatorField } from "./CreatorField";

/** Finite-number input with consistent creator form presentation. */
export function CreatorNumberField({
  label,
  value,
  onChange,
  step = 0.01,
  min,
  max,
  disabled = false,
  compact = false,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <CreatorField
      label={label}
      htmlFor={id}
      className={className}
      labelClassName={cn(compact && "text-[11px]")}
    >
      <Input
        id={id}
        aria-label={label}
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </CreatorField>
  );
}
