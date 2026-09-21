"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type MemoryMarkdownPreviewProps = {
  value: string;
  emptyText?: string;
  className?: string;
  allowImages?: boolean;
  /** Hide a duplicate opening H1 in the preview without changing its source. */
  hideLeadingHeading?: string;
};

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

/** Read parsed text so Markdown emphasis, links and entities match visibly. */
function renderedText(node: MarkdownNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(renderedText).join("") ?? "";
}

export function MemoryMarkdownPreview({
  value,
  emptyText = "_Empty file_",
  className,
  allowImages = true,
  hideLeadingHeading,
}: MemoryMarkdownPreviewProps) {
  const markdown = value.trim() || emptyText;

  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          ...(hideLeadingHeading
            ? {
                h1: ({ node, ...props }) =>
                  node?.position?.start.offset === 0 &&
                  renderedText(node) === hideLeadingHeading ? null : (
                    <h1 {...props} />
                  ),
              }
            : {}),
          ...(!allowImages
            ? { img: ({ alt }) => <span>[Image: {alt || "not loaded"}]</span> }
            : {}),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
