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
};

export function MemoryMarkdownPreview({
  value,
  emptyText = "_Empty file_",
  className,
  allowImages = true,
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
