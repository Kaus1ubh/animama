// Adapted from shadcn/ui (MIT): apps/www/registry/new-york/ui/tabs.tsx.
// See licenses/third-party/adapted-code.md.
"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Underlined text tabs, as on the Library page: a bottom-bordered strip that
 * scrolls sideways when its tabs do not fit, and an accent underline under the
 * active tab. Plain buttons and Radix triggers share these classes.
 */
export const UNDERLINE_TAB_LIST_CLASS = "flex gap-1 overflow-x-auto border-b";

/** Classes for one underlined tab; `active` draws the accent underline. */
export function underlineTabClassName(active: boolean): string {
  return cn(
    "min-h-11 shrink-0 border-b-2 px-4 text-sm",
    active
      ? "border-primary text-foreground"
      : "text-muted-foreground border-transparent",
  );
}

/** `underline` renders Library-style tabs; see `underlineTabClassName`. */
type TabsVariant = "default" | "underline";

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: TabsVariant;
  }
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      variant === "underline"
        ? UNDERLINE_TAB_LIST_CLASS
        : "bg-muted text-muted-foreground inline-flex h-10 items-center justify-center rounded-md p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

/**
 * A tab trigger. The `underline` variant carries only focus and disabled
 * styles; pass `underlineTabClassName(active)` as its class name.
 */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    variant?: TabsVariant;
  }
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      variant === "underline"
        ? "ring-offset-background focus-visible:ring-ring whitespace-nowrap focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        : "ring-offset-background focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "ring-offset-background focus-visible:ring-ring mt-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
