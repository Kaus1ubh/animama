import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";

import { Button } from "@/ui/components/button";
import { CreatorSaveNotice } from "./CreatorSaveNotice";

/** Full-page placeholder while a creator reads its saved item. */
export function CreatorLoadingState({ message }: { message: string }) {
  return (
    <div className="bg-background flex h-full items-center justify-center">
      <div
        className="text-muted-foreground flex items-center gap-2"
        role="status"
      >
        <LoaderCircleIcon
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {message}
      </div>
    </div>
  );
}

/**
 * Full-page state for a creator route whose saved item is missing or unreadable.
 * Replaces the workspace so a blank document cannot be mistaken for the item.
 */
export function CreatorUnavailableState({
  label,
  message,
}: {
  /** Singular content name, such as "Avatar Effect". */
  label: string;
  message: string;
}) {
  return (
    <div className="bg-background flex h-full items-center justify-center p-4">
      <CreatorSaveNotice
        className="w-full max-w-md text-sm"
        tone="error"
        message={
          <>
            <span className="block font-medium">Can’t open this {label}</span>
            <span className="text-muted-foreground">{message}</span>
          </>
        }
        actions={
          <div className="flex w-full justify-end gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/library">Open Library</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/create">Go to Create</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
