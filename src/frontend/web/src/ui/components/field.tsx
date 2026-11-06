import * as React from "react";

import { Label } from "@/ui/components/label";
import { cn } from "@/lib/utils";

type FieldProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "vertical" | "horizontal";
};

export function Field({
  className,
  orientation = "vertical",
  ...props
}: FieldProps) {
  return (
    <div
      className={cn(
        orientation === "horizontal"
          ? "flex items-center justify-between gap-3"
          : "flex flex-col gap-2",
        className,
      )}
      {...props}
    />
  );
}

export function FieldGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-4", className)} {...props} />;
}

export function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return <Label className={cn(className)} {...props} />;
}

export function FieldDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-muted-foreground text-sm", className)} {...props} />
  );
}

/** A validation error; only its message is shown. */
type FieldErrorEntry = { message?: string };

type FieldErrorProps = {
  errors: Array<FieldErrorEntry | undefined | null>;
  className?: string;
};

export function FieldError({ errors, className }: FieldErrorProps) {
  const message = errors
    .map((err) => err?.message)
    .find((m): m is string => typeof m === "string" && m.length > 0);

  if (!message) return null;

  return (
    <p
      role="alert"
      className={cn("text-destructive text-sm font-medium", className)}
    >
      {message}
    </p>
  );
}
