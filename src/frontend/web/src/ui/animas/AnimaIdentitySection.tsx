import type { MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { Button } from "@/ui/components/button";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

const IDENTITY_ACTION_CLASS = "bg-background/92 shadow-sm backdrop-blur-sm";

export function AnimaIdentitySection({
  animaId,
  identity,
  identityLoading,
  identityError,
  fallbackIdentity,
  onEdit,
  showEditAction = true,
}: {
  animaId: string;
  identity: string;
  identityLoading: boolean;
  identityError: boolean;
  fallbackIdentity: string;
  showEditAction?: boolean;
  onEdit?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const previewClass = "text-foreground/90 [overflow-wrap:anywhere]";
  const layoutClass = "flex min-w-0 flex-col gap-3";
  const editIdentityButton = (
    <Button
      asChild
      size="sm"
      variant="outline"
      className={IDENTITY_ACTION_CLASS}
    >
      {onEdit ? (
        <button id="anima-identity-edit-trigger" type="button" onClick={onEdit}>
          <FileText className="size-4" />
          Edit identity
        </button>
      ) : (
        <Link
          id="anima-identity-edit-trigger"
          to="/a/animas/$animaId/identity"
          params={{ animaId }}
          search={{ tab: "overview" }}
        >
          <FileText className="size-4" />
          Edit identity
        </Link>
      )}
    </Button>
  );
  const identityActions = showEditAction ? (
    <div className="not-prose float-right mb-3 ml-4 flex flex-wrap justify-end gap-2">
      {editIdentityButton}
    </div>
  ) : null;

  return (
    <div className={layoutClass}>
      {identityLoading ? (
        <p className="text-muted-foreground flex h-full items-center justify-center py-8 text-center text-sm">
          Loading identity…
        </p>
      ) : identityError ? (
        <div className={layoutClass}>
          <p className="text-destructive text-sm">
            The current identity memory file could not be loaded.
          </p>
          <div className={layoutClass}>
            <MemoryMarkdownPreview
              value={fallbackIdentity}
              emptyText="_No starter identity is available._"
              className={previewClass}
            >
              {identityActions}
            </MemoryMarkdownPreview>
          </div>
        </div>
      ) : (
        <div className={layoutClass}>
          <MemoryMarkdownPreview
            value={identity}
            emptyText="_No identity content provided yet._"
            className={previewClass}
          >
            {identityActions}
          </MemoryMarkdownPreview>
        </div>
      )}
    </div>
  );
}
