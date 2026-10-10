"use client";

import type { ComponentType, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { resolveAppShellSidebarLayout } from "@/ui/app/appShellSidebarLayout";

/** Icon component for a navigation section, e.g. a lucide icon. */
export type SectionIcon = ComponentType<{ className?: string }>;

type SectionedModalFrameProps<T extends string> = {
  title: string;
  description: string;
  closeLabel: string;
  sidebarLabel: ReactNode;
  sidebarTitle: ReactNode;
  sections: readonly T[];
  activeSection: T;
  onSectionChange: (section: T) => void;
  /** Rendered above the section navigation, e.g. a search field. */
  sidebarHeader?: ReactNode;
  /** Optional leading icon for each navigation item. */
  sectionIcons?: Partial<Record<T, SectionIcon>>;
  /** Displayed section names; sections are shown by ID when absent. */
  sectionLabels?: Partial<Record<T, string>>;
  onEscapeKeyDown?: Dialog.DialogContentProps["onEscapeKeyDown"];
  /**
   * Centre the modal in the area beside the desktop sidebar (which stays above
   * dialog backdrops) instead of the whole viewport, so the two never overlap.
   */
  avoidSidebar?: boolean;
  headerTitle: ReactNode;
  headerDescription?: ReactNode;
  headerMeta?: ReactNode;
  children: ReactNode;
  navLabel?: ReactNode;
  dialogClassName?: string;
  gridClassName?: string;
  contentClassName?: string;
};

export function SectionedModalFrame<T extends string>({
  title,
  description,
  closeLabel,
  sections,
  activeSection,
  onSectionChange,
  sidebarHeader,
  sectionIcons,
  sectionLabels,
  onEscapeKeyDown,
  avoidSidebar = false,
  headerTitle,
  headerDescription,
  headerMeta,
  children,
  dialogClassName,
  gridClassName,
  contentClassName,
}: SectionedModalFrameProps<T>) {
  const appShell = useOptionalAppShell();
  const sidebarInset = resolveAppShellSidebarLayout({
    behavior: "inset",
    isDesktop: appShell?.isDesktop === true,
    sidebarOpen: appShell?.sidebarOpen === true,
  })["--app-shell-sidebar-inset"];
  return (
    <Dialog.Content
      onEscapeKeyDown={onEscapeKeyDown}
      style={
        avoidSidebar
          ? {
              left: `calc(50% + ${sidebarInset} / 2)`,
              maxWidth: `calc(100vw - ${sidebarInset} - 2rem)`,
            }
          : undefined
      }
      className={cn(
        "fixed top-0 left-1/2 z-50 w-[min(920px,92vw)] -translate-x-1/2",
        "border-border bg-background h-[85vh] overflow-hidden rounded-b-2xl border shadow-2xl",
        "md:top-1/2 md:h-[80vh] md:-translate-y-1/2 md:rounded-2xl",
        "data-[state=closed]:opacity-0",
        dialogClassName,
      )}
    >
      <Dialog.Title className="sr-only">{title}</Dialog.Title>
      <Dialog.Description className="sr-only">{description}</Dialog.Description>
      <div
        className={cn(
          "grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1",
          gridClassName,
        )}
      >
        <aside className="border-border bg-muted/30 flex min-h-0 flex-col border-b p-4 md:border-r md:border-b-0">
          {/* Outside the scrolling nav so dropdowns anchored here aren't clipped. */}
          {sidebarHeader ? (
            <div className="relative z-20 mb-3">{sidebarHeader}</div>
          ) : null}
          <nav className="flex min-h-0 flex-wrap gap-2 overflow-y-auto md:flex-col md:gap-1">
            {sections.map((section) => {
              const active = section === activeSection;
              const Icon: SectionIcon | undefined = sectionIcons?.[section];
              return (
                <button
                  key={section}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (active) return;
                    onSectionChange(section);
                  }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition",
                    "hover:bg-muted/70",
                    active
                      ? "bg-muted text-foreground font-semibold"
                      : "text-muted-foreground",
                  )}
                >
                  {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                  {sectionLabels?.[section] ?? section}
                </button>
              );
            })}
          </nav>
        </aside>
        <section
          className={cn(
            "flex min-h-0 flex-col gap-4 overflow-y-auto p-6",
            contentClassName,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-foreground text-lg font-semibold">
                {headerTitle}
              </h2>
              {headerDescription ? (
                <p className="text-muted-foreground text-sm">
                  {headerDescription}
                </p>
              ) : null}
              {headerMeta}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  "text-muted-foreground hover:bg-muted/60 hover:text-foreground transition",
                )}
                aria-label={closeLabel}
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </section>
      </div>
    </Dialog.Content>
  );
}
