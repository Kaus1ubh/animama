import {
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";
import { cn } from "@/lib/utils";

import { MODEL_LOCATION_TABS } from "./model-configuration-state";

/**
 * The Cloud | Local tab strip shared by setup's AI step and App Settings →
 * Models: two centered tabs, each half the width.
 */
export function ModelLocationTabsList({ active }: { active: string }) {
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
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
