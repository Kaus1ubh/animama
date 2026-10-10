import { type ReactNode, useState } from "react";
import { useProductApiClient } from "@animama/product-ui";
import { Link } from "@tanstack/react-router";
import { Lock, Play } from "lucide-react";

import { previewTypedCatalogItem } from "@/lib/content/catalogApi";
import { isNonPortable, NON_PORTABLE_REASON } from "@/lib/content/portability";
import { typedActionPreview } from "@/lib/content/typedPreviewAdapters";
import { actionPreviewTarget } from "@/lib/content-preview/actionPreviewTarget";
import { useAction } from "@/query/hooks/useActions";
import { useContentPreviewDock } from "@/ui/content-preview/ContentPreviewDockProvider";
import { Button } from "@/ui/components/button";

/**
 * Open a saved Gesture or Reaction in the creator only when it may be edited.
 *
 * A non-portable item is shown for preview only: its motion never loads into a
 * draft that could be saved, copied or exported. New items and items that fail
 * to load fall through to the editor, which reports its own errors.
 */
export function ActionEditorGate({
  intent,
  itemId,
  children,
}: {
  intent: "gesture" | "reaction";
  itemId?: string;
  children: ReactNode;
}) {
  const action = useAction(intent, itemId ?? null);
  if (itemId && action.isPending)
    return (
      <p role="status" className="text-muted-foreground p-8 text-sm">
        Loading…
      </p>
    );
  if (itemId && action.data && isNonPortable(action.data)) {
    return (
      <NonPortableActionNotice
        intent={intent}
        itemId={itemId}
        name={action.data.name}
        description={action.data.description}
      />
    );
  }
  return children;
}

function NonPortableActionNotice({
  intent,
  itemId,
  name,
  description,
}: {
  intent: "gesture" | "reaction";
  itemId: string;
  name: string;
  description: string | null;
}) {
  const apiClient = useProductApiClient();
  const { openPreview } = useContentPreviewDock();
  const [error, setError] = useState<string | null>(null);
  const preview = async () => {
    setError(null);
    try {
      const value = typedActionPreview(
        await previewTypedCatalogItem(apiClient, intent, itemId),
      );
      openPreview(actionPreviewTarget(value, name));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This item could not be previewed.",
      );
    }
  };
  return (
    <section
      className="mx-auto flex max-w-xl flex-col gap-4 p-8"
      aria-labelledby="non-portable-action-title"
    >
      <div className="text-muted-foreground flex items-center gap-2">
        <Lock className="size-4" aria-hidden="true" />
        <span className="text-sm">Preview only</span>
      </div>
      <h1 id="non-portable-action-title" className="text-xl font-semibold">
        {name}
      </h1>
      {description ? <p className="text-sm">{description}</p> : null}
      <p className="text-muted-foreground text-sm">{NON_PORTABLE_REASON}</p>
      <div className="flex gap-2">
        <Button onClick={() => void preview()}>
          <Play /> Preview
        </Button>
        <Button variant="outline" asChild>
          <Link to="/library">Back to Library</Link>
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
