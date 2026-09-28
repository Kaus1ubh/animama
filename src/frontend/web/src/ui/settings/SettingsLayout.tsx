import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Class overrides that flatten a self-contained settings panel (which renders
 * as a bordered card elsewhere) into the App Settings list style.
 */
export const FLAT_SETTINGS_PANEL_CLASS_NAME =
  "rounded-none border-0 bg-transparent p-0";

/** Titled block of settings rows separated by hairline dividers, without card chrome. */
export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col", className)}>
      {title ? (
        <div className="pb-1">
          <h3 className="text-foreground text-base font-semibold">{title}</h3>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="divide-border/60 flex flex-col divide-y">{children}</div>
    </section>
  );
}

/**
 * One setting: label and description on the left, its control on the right.
 * `children` renders full-width below for status notes or nested panels.
 */
export function SettingsRow({
  label,
  description,
  control,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-foreground text-sm font-medium">{label}</div>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {description}
            </p>
          ) : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children}
    </div>
  );
}
