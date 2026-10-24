import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";

/** One tab of a choice strip. */
export type ChoiceTab = {
  id: string;
  label: ReactNode;
  /** Marked with a "Recommended" tag. */
  recommended?: boolean;
  disabled?: boolean;
  /** Why a disabled tab is unavailable (its tooltip). */
  reason?: string;
};

/**
 * The top-level choice strip shared by setup and App Settings, in the Cloud |
 * Local style: centered tabs of equal width, one optionally tagged as
 * recommended. Render inside a `Tabs` whose values are the tab ids.
 */
export function ChoiceTabsList({
  tabs,
  active,
  label,
  recommendedLabel,
}: {
  tabs: readonly ChoiceTab[];
  active: string;
  /** Accessible name of the strip. */
  label: string;
  /** Text of the recommended tag. */
  recommendedLabel?: string;
}) {
  return (
    <TabsList variant="underline" aria-label={label} className="gap-0">
      {tabs.map((tab) => (
        <TabsTrigger
          key={tab.id}
          value={tab.id}
          variant="underline"
          disabled={tab.disabled}
          title={tab.disabled ? tab.reason : undefined}
          className={cn(underlineTabClassName(active === tab.id), "flex-1")}
        >
          {tab.recommended && recommendedLabel ? (
            <span className="inline-flex items-center gap-2">
              {tab.label}
              <span className="bg-primary/10 text-primary text-2xs rounded-sm px-1.5 py-0.5 font-medium">
                {recommendedLabel}
              </span>
            </span>
          ) : (
            tab.label
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/**
 * The second-level strip under a choice, in the provider-tab style:
 * left-aligned, tightly padded underline tabs. Render inside a `Tabs` whose
 * values are the tab ids.
 */
export function VariantTabsList({
  tabs,
  active,
  label,
}: {
  tabs: readonly ChoiceTab[];
  active: string;
  label: string;
}) {
  return (
    <TabsList
      variant="underline"
      aria-label={label}
      className="w-fit max-w-full"
    >
      {tabs.map((tab) => (
        <TabsTrigger
          key={tab.id}
          value={tab.id}
          variant="underline"
          disabled={tab.disabled}
          title={tab.disabled ? tab.reason : undefined}
          className={cn(underlineTabClassName(active === tab.id), "px-2")}
        >
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
