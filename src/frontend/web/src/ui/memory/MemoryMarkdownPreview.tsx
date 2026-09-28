"use client";

import type { ReactNode } from "react";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

import "./memory-markdown.css";

type MemoryMarkdownPreviewProps = {
  value: string;
  children?: ReactNode;
  emptyText?: string;
  className?: string;
  allowImages?: boolean;
  /** Open links outside the app, so following one never navigates the current view. */
  externalLinks?: boolean;
};

export function MemoryMarkdownPreview({
  value,
  children,
  emptyText = "_Empty file_",
  className,
  allowImages = true,
  externalLinks = false,
}: MemoryMarkdownPreviewProps) {
  const markdown = value.trim() || emptyText;

  return (
    <div className={cn("flow-root max-w-none", className)}>
      {children}
      {/* Caller-supplied controls stay outside the document typography. */}
      <div className="memory-markdown-colors memory-markdown-preview prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{
            ...(!allowImages
              ? {
                  img: ({ alt }) => <span>[Image: {alt || "not loaded"}]</span>,
                }
              : {}),
            ...(externalLinks
              ? {
                  a: ({ href, children: linkChildren }) => (
                    <a href={href} target="_blank" rel="noreferrer">
                      {linkChildren}
                    </a>
                  ),
                }
              : {}),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
