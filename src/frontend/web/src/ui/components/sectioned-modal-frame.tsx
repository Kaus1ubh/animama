"use client";

import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

type SectionedModalFrameProps<T extends string> = {
  title: string;
  description: string;
  closeLabel: string;
  sidebarLabel: ReactNode;
  sidebarTitle: ReactNode;
  sections: readonly T[];
  activeSection: T;
  onSectionChange: (section: T) => void;
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
  sidebarLabel,
  sidebarTitle,
  sections,
  activeSection,
  onSectionChange,
  headerTitle,
  headerDescription,
  headerMeta,
  children,
  navLabel = "Sections",
  dialogClassName,
  gridClassName,
  contentClassName,
}: SectionedModalFrameProps<T>) {
  return (
    <Dialog.Content
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
        <aside className="border-border bg-muted/30 overflow-y-auto border-b p-4 md:border-r md:border-b-0">
          <div className="mb-4">
            <div className="mb-3 flex items-center justify-between md:hidden">
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  {sidebarLabel}
                </p>
                <p className="text-foreground mt-1 text-sm font-semibold">
                  {sidebarTitle}
                </p>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-full",
                    "text-muted-foreground hover:bg-muted/60 hover:text-foreground transition",
                  )}
                  aria-label={closeLabel}
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <div className="hidden md:block">
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                {sidebarLabel}
              </p>
              <p className="text-foreground mt-1 text-sm font-semibold">
                {sidebarTitle}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wider uppercase">
            {navLabel}
          </p>
          <nav className="flex flex-wrap gap-2 md:flex-col md:gap-1">
            {sections.map((section) => {
              const active = section === activeSection;
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => {
                    if (active) return;
                    onSectionChange(section);
                  }}
                  className={cn(
                    "flex items-center rounded-md px-3 py-2 text-left text-sm transition",
                    "hover:bg-muted/70",
                    active
                      ? "bg-muted text-foreground font-semibold"
                      : "text-muted-foreground",
                  )}
                >
                  {section}
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
                  "hidden h-9 w-9 items-center justify-center rounded-full md:inline-flex",
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
