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
  decimalPlaces,
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
  /** Optional display and input precision; stored values are untouched until edited. */
  decimalPlaces?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const id = useId();
  const round = (number: number) =>
    decimalPlaces === undefined
      ? number
      : Number(number.toFixed(decimalPlaces));
  return (
    <CreatorField
      label={label}
      htmlFor={id}
      className={className}
      labelClassName={cn(compact && "text-[11px]")}
    >
      <Input
        className={cn("h-8 text-xs", compact && "px-2")}
        id={id}
        aria-label={label}
        type="number"
        value={Number.isFinite(value) ? round(value) : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(round(next));
        }}
      />
    </CreatorField>
  );
}
