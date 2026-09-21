import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { Button } from "@/ui/components/button";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

const IDENTITY_PREVIEW_CLASS =
  "anima-identity-scrollbar border-border/70 bg-muted/25 text-foreground/90 max-h-[clamp(12rem,calc(55dvh-12.5rem),32rem)] overflow-auto rounded-xl border p-5 pt-14 [overflow-wrap:anywhere] xl:h-full xl:max-h-none";

export function AnimaIdentitySection({
  animaId,
  identity,
  identityLoading,
  identityError,
  fallbackIdentity,
  onEdit,
}: {
  animaId: string;
  identity: string;
  identityLoading: boolean;
  identityError: boolean;
  fallbackIdentity: string;
  onEdit?: () => void;
}) {
  const editIdentityButton = (
    <Button
      asChild
      size="sm"
      variant="outline"
      className="bg-background/92 absolute top-3 right-3 z-10 shadow-sm backdrop-blur-sm"
    >
      <Link
        id="anima-identity-edit-trigger"
        onClick={onEdit}
        to="/a/animas/$animaId/identity"
        params={{ animaId }}
        search={{ tab: "overview" }}
      >
        <FileText className="size-4" />
        Edit identity
      </Link>
    </Button>
  );

  return (
    <div className="xl:h-full xl:min-h-0">
      {identityLoading ? (
        <p className="text-muted-foreground flex h-full items-center justify-center py-8 text-center text-sm">
          Loading identity…
        </p>
      ) : identityError ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <p className="text-destructive text-sm">
            The current identity memory file could not be loaded.
          </p>
          <div className="relative min-h-0 flex-1">
            {editIdentityButton}
            <MemoryMarkdownPreview
              value={fallbackIdentity}
              emptyText="_No starter identity is available._"
              className={IDENTITY_PREVIEW_CLASS}
            />
          </div>
        </div>
      ) : (
        <div className="relative xl:h-full xl:min-h-0">
          {editIdentityButton}
          <MemoryMarkdownPreview
            value={identity}
            emptyText="_No identity content provided yet._"
            className={IDENTITY_PREVIEW_CLASS}
          />
        </div>
      )}
    </div>
  );
}
