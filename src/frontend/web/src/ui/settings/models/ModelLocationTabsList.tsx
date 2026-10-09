import {
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";
import { cn } from "@/lib/utils";

import { MODEL_LOCATION_TABS } from "./model-configuration-state";

/**
 * The Cloud | Local tab strip shared by setup's AI step and App Settings →
 * Models: two centered tabs, each half the width. `recommended` marks one
 * location with a tag (setup recommends Cloud).
 */
export function ModelLocationTabsList({
  active,
  recommended,
}: {
  active: string;
  recommended?: string;
}) {
  return (
    <TabsList
      variant="underline"
      aria-label="Where models run"
      className="gap-0"
    >
      {MODEL_LOCATION_TABS.map(({ id, label }) => (
        <TabsTrigger
          key={id}
          value={id}
          variant="underline"
          className={cn(underlineTabClassName(active === id), "flex-1")}
        >
          {id === recommended ? (
            <span className="inline-flex items-center gap-2">
              {label}
              <span className="bg-primary/10 text-primary text-2xs rounded-sm px-1.5 py-0.5 font-medium">
                Recommended
              </span>
            </span>
          ) : (
            label
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
