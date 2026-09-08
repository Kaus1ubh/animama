import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { cn } from "../lib/utils";

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className &&
    prevProps.animated === nextProps.animated &&
    prevProps.isAnimating === nextProps.isAnimating &&
    prevProps.parseMarkdownIntoBlocksFn === nextProps.parseMarkdownIntoBlocksFn,
);

Response.displayName = "Response";
