import type { MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { Button } from "@/ui/components/button";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";

const IDENTITY_PREVIEW_CLASS =
  "anima-identity-scrollbar border-border/70 bg-muted/25 text-foreground/90 max-h-[clamp(12rem,calc(55dvh-12.5rem),32rem)] overflow-auto rounded-xl border p-5 [overflow-wrap:anywhere] xl:h-full xl:max-h-none";

export function AnimaIdentitySection({
  animaId,
  identity,
  identityLoading,
  identityError,
  fallbackIdentity,
  onEdit,
  presentation = "panel",
}: {
  animaId: string;
  identity: string;
  identityLoading: boolean;
  identityError: boolean;
  fallbackIdentity: string;
  onEdit?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Plain previews follow their parent's scroll flow instead of owning a card. */
  presentation?: "panel" | "plain";
}) {
  const plain = presentation === "plain";
  const previewClass = plain
    ? "text-foreground/90 [overflow-wrap:anywhere]"
    : IDENTITY_PREVIEW_CLASS;
  const plainLayoutClass = "flex min-w-0 flex-col gap-3";
  const editIdentityButton = (
    <Button
      asChild
      size="sm"
      variant="outline"
      className="not-prose bg-background/92 float-right mb-3 ml-4 shadow-sm backdrop-blur-sm"
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

  return (
    <div className={plain ? plainLayoutClass : "xl:h-full xl:min-h-0"}>
      {identityLoading ? (
        <p className="text-muted-foreground flex h-full items-center justify-center py-8 text-center text-sm">
          Loading identity…
        </p>
      ) : identityError ? (
        <div
          className={
            plain ? plainLayoutClass : "flex h-full min-h-0 flex-col gap-3"
          }
        >
          <p className="text-destructive text-sm">
            The current identity memory file could not be loaded.
          </p>
          <div className={plain ? plainLayoutClass : "relative min-h-0 flex-1"}>
            <MemoryMarkdownPreview
              value={fallbackIdentity}
              emptyText="_No starter identity is available._"
              className={previewClass}
            >
              {editIdentityButton}
            </MemoryMarkdownPreview>
          </div>
        </div>
      ) : (
        <div
          className={plain ? plainLayoutClass : "relative xl:h-full xl:min-h-0"}
        >
          <MemoryMarkdownPreview
            value={identity}
            emptyText="_No identity content provided yet._"
            className={previewClass}
          >
            {editIdentityButton}
          </MemoryMarkdownPreview>
        </div>
      )}
    </div>
  );
}
