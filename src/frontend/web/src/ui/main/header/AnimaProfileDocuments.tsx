import type { ComponentProps, MouseEvent } from "react";
import { FileText } from "lucide-react";

import { useAnimaMemoriesEntry } from "@/query/hooks/useMemoryEntries";
import { AnimaIdentitySection } from "@/ui/animas/AnimaIdentitySection";
import { AnimaMemoriesSection } from "@/ui/animas/AnimaMemoriesSection";
import { Button } from "@/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";

type DocumentTab = "identity" | "memories";
type Props = Pick<
  ComponentProps<typeof AnimaIdentitySection>,
  | "animaId"
  | "identity"
  | "identityLoading"
  | "identityError"
  | "fallbackIdentity"
> & {
  tab: DocumentTab;
  onTabChange: (tab: DocumentTab) => void;
  onEdit: (
    event: MouseEvent<HTMLButtonElement>,
    file: { path: "IDENTITY.md" } | { entryId: string },
  ) => void;
};

/** Keep document navigation and its matching edit action together under the portrait. */
export function AnimaProfileDocuments({
  tab,
  onTabChange,
  onEdit,
  ...identityProps
}: Props) {
  const memories = useAnimaMemoriesEntry(
    tab === "memories" ? identityProps.animaId : null,
  );
  const tabClass =
    "h-11 rounded-none border-b-2 border-transparent px-2 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-3";

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as DocumentTab)}
      className="mt-6"
    >
      <div className="border-border/70 flex flex-wrap items-center justify-between gap-x-3 border-b">
        <TabsList
          aria-label="Anima documents"
          className="h-auto gap-1 rounded-none bg-transparent p-0"
        >
          <TabsTrigger value="identity" className={tabClass}>
            Identity
          </TabsTrigger>
          <TabsTrigger value="memories" className={tabClass}>
            Memories
          </TabsTrigger>
        </TabsList>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="my-2 ml-auto"
          disabled={tab === "memories" && !memories}
          onClick={(event) => {
            if (tab === "identity") onEdit(event, { path: "IDENTITY.md" });
            else if (memories) onEdit(event, { entryId: memories.id });
          }}
        >
          <FileText className="size-4" aria-hidden="true" />
          {tab === "identity" ? "Edit identity" : "Edit memories"}
        </Button>
      </div>
      <TabsContent value="identity" className="mt-5">
        <AnimaIdentitySection {...identityProps} showEditAction={false} />
      </TabsContent>
      <TabsContent value="memories" className="mt-5">
        <AnimaMemoriesSection
          animaId={identityProps.animaId}
          showEditAction={false}
        />
      </TabsContent>
    </Tabs>
  );
}
