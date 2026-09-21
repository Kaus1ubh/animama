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
  presentation = "panel",
  displayName,
}: {
  animaId: string;
  identity: string;
  identityLoading: boolean;
  identityError: boolean;
  fallbackIdentity: string;
  onEdit?: () => void;
  /** Plain previews follow their parent's scroll flow instead of owning a card. */
  presentation?: "panel" | "plain";
  displayName?: string;
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
      className={
        plain
          ? "shrink-0"
          : "bg-background/92 absolute top-3 right-3 z-10 shadow-sm backdrop-blur-sm"
      }
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
    <div className={plain ? plainLayoutClass : "xl:h-full xl:min-h-0"}>
      {plain ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-foreground text-base font-semibold">Identity</h2>
          {!identityLoading ? editIdentityButton : null}
        </div>
      ) : null}
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
            {!plain ? editIdentityButton : null}
            <MemoryMarkdownPreview
              value={fallbackIdentity}
              emptyText="_No starter identity is available._"
              className={previewClass}
              hideLeadingHeading={plain ? displayName : undefined}
            />
          </div>
        </div>
      ) : (
        <div
          className={plain ? plainLayoutClass : "relative xl:h-full xl:min-h-0"}
        >
          {!plain ? editIdentityButton : null}
          <MemoryMarkdownPreview
            value={identity}
            emptyText="_No identity content provided yet._"
            className={previewClass}
            hideLeadingHeading={plain ? displayName : undefined}
          />
        </div>
      )}
    </div>
  );
}
