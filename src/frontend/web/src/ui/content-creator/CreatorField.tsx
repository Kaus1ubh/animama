import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Field, FieldLabel } from "@/ui/components/field";

/** Shared label and spacing for creator form controls. */
export function CreatorField({
  label,
  children,
  className,
  labelClassName,
  htmlFor,
  invalid = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
  htmlFor?: string;
  /** Visually associate an actionable creator failure with this control. */
  invalid?: boolean;
}) {
  return (
    <Field
      data-invalid={invalid || undefined}
      className={cn(
        "gap-1.5",
        invalid && "bg-destructive/5 ring-destructive/40 rounded-lg p-2 ring-1",
        className,
      )}
    >
      <FieldLabel
        htmlFor={htmlFor}
        className={cn("text-xs", invalid && "text-destructive", labelClassName)}
      >
        {label}
      </FieldLabel>
      {children}
    </Field>
  );
}
