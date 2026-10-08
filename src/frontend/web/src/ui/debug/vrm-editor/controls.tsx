"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/ui/components/input";

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-border/60 bg-muted/10 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-foreground text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="text-muted-foreground mt-1 text-xs">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function KeyValueGrid({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="border-border/60 bg-background/70 rounded-lg border p-3"
        >
          <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            {row.label}
          </p>
          <div className="text-foreground mt-1 min-w-0 text-sm break-words">
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border-border/70 bg-muted/10 rounded-xl border border-dashed p-6">
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{description}</p>
    </div>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="border-warning/30 bg-warning/10 rounded-xl border p-4">
      <p className="text-foreground text-sm font-medium">Warnings</p>
      <ul className="text-foreground/85 mt-2 space-y-1 text-sm">
        {warnings.map((warning, index) => (
          <li key={`${warning}:${index}`}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="border-border/60 overflow-x-scroll overflow-y-hidden rounded-lg border [scrollbar-gutter:stable]">
      <table className="divide-border/60 min-w-full divide-y text-left text-sm">
        {children}
      </table>
    </div>
  );
}

export function HeaderCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "bg-muted/40 text-muted-foreground text-2xs px-3 py-2 font-semibold tracking-wide uppercase",
        className,
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

export function BodyCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("text-foreground px-3 py-2 align-top", className)}>
      {children}
    </td>
  );
}

export function SelectControl({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="border-border/60 bg-background text-foreground h-8 w-full rounded-md border px-2 text-sm"
    >
      {children}
    </select>
  );
}

export function TextInputControl({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="border-border/60 bg-background text-foreground h-8 w-full rounded-md border px-2 text-sm"
    />
  );
}

export function NumberInputControl({
  value,
  onChange,
  step = "0.01",
  disabled = false,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      type="number"
      allowEmptyNumber
      value={typeof value === "number" ? value : ""}
      disabled={disabled}
      onChange={(event) => {
        const nextValue = event.target.value.trim();
        if (nextValue.length === 0) {
          onChange(undefined);
          return;
        }
        const parsed = Number(nextValue);
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }}
      step={step}
      className="border-border/60 bg-background text-foreground disabled:text-muted-foreground h-8 w-full rounded-md border px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

export function ColorInputControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const colorValue = /^#([\da-f]{3}|[\da-f]{6})$/i.test(value)
    ? value
    : "#ffffff";

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={colorValue}
        onChange={(event) => onChange(event.target.value)}
        className="border-border/60 bg-background h-8 w-10 shrink-0 rounded-md border p-1"
      />
      <TextInputControl
        value={value}
        onChange={onChange}
        placeholder="#ffffff"
      />
    </div>
  );
}
