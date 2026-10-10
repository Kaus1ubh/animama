import { cn } from "@/lib/utils";
import {
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";

import {
  providerConnected,
  type ModelProviderGroup,
  type ProviderConnectionState,
} from "./model-configuration-state";

/**
 * The provider tabs under Cloud | Local, shared by setup's AI step and App
 * Settings → Models: left-aligned underline tabs in the location's provider
 * order, with a dot (and screen-reader text) on connected providers. Render
 * inside a `Tabs` whose values are the provider entry ids. Tabs are padded
 * more tightly than Library tabs so every Cloud provider fits the settings
 * dialog at desktop widths; narrower windows scroll the strip.
 */
export function ModelProviderTabsList({
  groups,
  active,
  label,
}: {
  groups: readonly ModelProviderGroup<ProviderConnectionState>[];
  active: string;
  /** Accessible name of the strip, e.g. "Cloud providers". */
  label: string;
}) {
  return (
    <TabsList
      variant="underline"
      aria-label={label}
      className="w-fit max-w-full"
    >
      {groups.map((group) => {
        const { id, label: name } = group.entry;
        return (
          <TabsTrigger
            key={id}
            value={id}
            variant="underline"
            className={cn(underlineTabClassName(active === id), "px-2")}
          >
            <span className="inline-flex items-center gap-1.5">
              {name}
              {providerConnected(group) ? (
                <>
                  <span
                    aria-hidden
                    className="bg-primary size-1.5 rounded-full"
                  />
                  <span className="sr-only">{" (connected)"}</span>
                </>
              ) : null}
            </span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
