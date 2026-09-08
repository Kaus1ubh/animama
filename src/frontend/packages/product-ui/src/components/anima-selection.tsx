import type { ReactNode } from "react";
import type { PyAnimaListItem } from "@animama/runtime-contracts/api-types";
import { getAnimaDisplayName, getAnimaInitials } from "../lib/anima-profile";
import { useAnimaPresentationImage } from "../query/hooks/useAnimaPresentationImage";
import { runtimeImageStyle } from "../lib/imagePresentation";
import { cn } from "../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
/** Render one Anima portrait consistently across sidebar list densities. */
export function AnimaAvatar({
  anima,
  displayName,
  isActive,
  variant = "default",
}: {
  anima: PyAnimaListItem;
  displayName: string;
  isActive: boolean;
  variant?: "default" | "compact" | "chat";
}) {
  const compact = variant === "compact";
  const presentationImage = useAnimaPresentationImage(
    anima.presentation.profile_thumbnail,
  );
  const avatarSrc = presentationImage.url;
  return (
    <Avatar
      className={cn(
        variant === "default" && "size-9",
        compact && "size-12",
        variant === "chat" && "size-5",
      )}
    >
      {avatarSrc ? (
        <AvatarImage
          alt={`${displayName} avatar`}
          className={cn(
            compact && "transition-[filter,opacity] duration-200",
            compact && !isActive && "opacity-70 grayscale",
          )}
          src={avatarSrc}
          style={runtimeImageStyle(presentationImage.presentation)}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "text-xs font-medium",
          compact && !isActive && "bg-muted text-muted-foreground",
        )}
      >
        {getAnimaInitials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

export type AnimaSelectionItemProps = {
  className: string;
  children: ReactNode;
  "aria-label": string;
  "aria-current"?: "true";
};
/** Product selection markup shared by local route links and other runtime owners. */
export function AnimaSelection({
  animas,
  selectedAnimaId,
  onSelect,
  renderItem,
}: {
  animas: readonly PyAnimaListItem[];
  selectedAnimaId?: string | null;
  onSelect?: (id: string) => void;
  renderItem?: (
    anima: PyAnimaListItem,
    props: AnimaSelectionItemProps,
  ) => ReactNode;
}) {
  return (
    <div className="animama-anima-selection flex flex-col gap-1">
      {animas.map((anima) => {
        const displayName = getAnimaDisplayName(anima);
        const isActive = anima.id === selectedAnimaId;
        const props: AnimaSelectionItemProps = {
          className: cn(
            "animama-anima-selection-item group flex h-[44px] w-full items-center gap-3 rounded-md px-2.5 text-left text-sm",
            "text-foreground/90 hover:bg-sidebar-accent/60 transition-colors",
            isActive && "bg-sidebar-accent text-foreground",
          ),
          "aria-label": displayName,
          "aria-current": isActive ? "true" : undefined,
          children: (
            <>
              <AnimaAvatar
                anima={anima}
                displayName={displayName}
                isActive={isActive}
              />
              <span className="inline-block transition duration-150 group-hover:translate-x-1">
                {displayName}
              </span>
            </>
          ),
        };
        return (
          <div key={anima.id}>
            {renderItem ? (
              renderItem(anima, props)
            ) : (
              <button
                type="button"
                {...props}
                onClick={() => onSelect?.(anima.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
