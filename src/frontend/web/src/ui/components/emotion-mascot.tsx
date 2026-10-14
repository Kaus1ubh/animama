import { cn } from "@/lib/utils";

/**
 * The Animama mascot showing an Anima's current feeling. Decorative by
 * default: callers label the surrounding control with the feeling text.
 */
export function EmotionMascot({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className={cn("size-6 shrink-0 object-contain select-none", className)}
    />
  );
}
