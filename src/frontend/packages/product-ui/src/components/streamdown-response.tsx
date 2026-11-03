import { memo, type ComponentProps } from "react";
import {
  defaultComponents,
  defaultRehypePlugins,
  Streamdown,
  type Components,
  type LinkSafetyConfig,
} from "streamdown";
import "streamdown/styles.css";
import { useProductTranslation } from "../i18n/product-translation";
import { cn } from "../lib/utils";

type ResponseProps = ComponentProps<typeof Streamdown>;
type MarkdownImageProps = ComponentProps<typeof defaultComponents.img>;

/** Streamdown's `src` for an image whose markdown is still streaming in. */
const STREAMING_IMAGE_PLACEHOLDER = "streamdown:incomplete-image";

/**
 * Whether markdown may load `src` as an image: only an `http:` or `https:` URL
 * on the page's own origin, so showing a reply never requests another site.
 * Relative sources resolve as `<img>` would resolve them. Streamdown's
 * sanitizer removes other schemes, such as `blob:` and `data:`, before this.
 */
function isAppImageSource(src: string): boolean {
  // Server rendering has no page origin to compare with.
  if (typeof document === "undefined") return false;
  let url: URL;
  try {
    url = new URL(src, document.baseURI);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.origin === window.location.origin
  );
}

/**
 * Streamdown's image for same-origin sources and the streaming placeholder.
 * Any other image shows as its alt text and is never fetched.
 */
function MarkdownImage(props: MarkdownImageProps) {
  const { t } = useProductTranslation();
  const { src, alt } = props;
  if (
    typeof src === "string" &&
    (src === STREAMING_IMAGE_PLACEHOLDER || isAppImageSource(src))
  ) {
    return <defaultComponents.img {...props} />;
  }
  return (
    <span>
      {alt ? t("markdown.image", { alt }) : t("markdown.imageNotLoaded")}
    </span>
  );
}

const components: Components = { img: MarkdownImage };

/**
 * Streamdown's sanitize and harden steps without `rehype-raw`, so HTML in a
 * reply shows as text instead of becoming elements.
 */
const rehypePlugins = [
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.harden,
];

/**
 * Links open only from Streamdown's dialog, which shows the destination first.
 * Stated here so a library default cannot turn it off.
 */
const linkSafety: LinkSafetyConfig = { enabled: true };

// The image, HTML and link policies come after the caller's props, so no
// caller can replace them.
export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
      components={components}
      linkSafety={linkSafety}
      rehypePlugins={rehypePlugins}
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
