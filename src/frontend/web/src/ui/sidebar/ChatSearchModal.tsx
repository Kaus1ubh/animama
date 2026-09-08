"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Search, X } from "lucide-react";

import type {
  PyChatSearchResponse,
  PyChatSearchResult,
  PyAnimaPresentation,
} from "@/lib/content/catalogTypes";
import { useAnimaPresentationImage } from "@/query/hooks/useAnimaPresentationImage";
import { runtimeImageStyle } from "@/lib/runtime-content/imagePresentation";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useSearchChatMessages } from "@/query/mutations/useSearchChatMessages";
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { cn } from "@/lib/utils";

const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;

type ChatSearchModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function initials(value: string | null | undefined): string {
  const compact = value?.trim();
  if (!compact) return "?";
  const parts = compact.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase() || "?";
}

function resultTitle(result: PyChatSearchResult): string {
  return (
    result.chat_title?.trim() || result.anima_name?.trim() || "Untitled chat"
  );
}

function resultAnimaName(result: PyChatSearchResult, title: string): string {
  return result.anima_name?.trim() || title;
}

function resultDate(result: PyChatSearchResult): string | null {
  if (!result.created_at) return null;
  const date = new Date(result.created_at);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(value: string): string[] {
  const seen = new Set<string>();
  return (value.match(/[A-Za-z0-9_]{2,}/g) ?? [])
    .map((term) => term.toLowerCase())
    .filter((term) => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
}

function highlightMatches(value: string, query: string): ReactNode {
  const terms = queryTerms(query);
  if (terms.length === 0) return value;

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const out: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(matcher)) {
    const matchedText = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      out.push(value.slice(lastIndex, index));
    }
    out.push(
      <mark
        key={`${index}-${matchedText}`}
        className="text-foreground bg-transparent font-semibold"
      >
        {matchedText}
      </mark>,
    );
    lastIndex = index + matchedText.length;
  }

  if (lastIndex < value.length) {
    out.push(value.slice(lastIndex));
  }
  return out.length > 0 ? out : value;
}

function ChatSearchResultRow({
  result,
  presentation,
  query,
  onSelect,
}: {
  result: PyChatSearchResult;
  presentation?: PyAnimaPresentation;
  query: string;
  onSelect: (result: PyChatSearchResult) => void;
}) {
  const presentationImage = useAnimaPresentationImage(
    presentation?.profile_thumbnail,
  );
  const title = resultTitle(result);
  const animaName =
    presentation?.display_name || resultAnimaName(result, title);
  const date = resultDate(result);
  const profilePictureUrl = presentationImage.url;

  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className={cn(
        "group grid w-full grid-cols-[4rem_minmax(0,1fr)] gap-3 px-5 py-2.5 text-left",
        "hover:bg-muted/55 focus-visible:bg-muted/55 focus-visible:outline-none",
      )}
    >
      <div className="min-w-0">
        <Avatar className="mx-auto size-9 ring-1 ring-white/10">
          {profilePictureUrl ? (
            <AvatarImage
              src={profilePictureUrl}
              alt={`${title} profile`}
              style={runtimeImageStyle(presentationImage.presentation)}
            />
          ) : null}
          <AvatarFallback className="text-sm font-medium">
            {initials(animaName)}
          </AvatarFallback>
        </Avatar>
        <div
          className="text-muted-foreground mt-1 text-center text-[0.6875rem] leading-[0.875rem] [overflow-wrap:anywhere]"
          title={animaName}
        >
          {animaName}
        </div>
      </div>
      <div className="min-w-0">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
          <div className="text-foreground font-large truncate text-base leading-6">
            {title}
          </div>
          {date ? (
            <div className="text-muted-foreground hidden text-right text-xs sm:block">
              {date}
            </div>
          ) : null}
        </div>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm leading-5">
          {highlightMatches(result.snippet, query)}
        </p>
      </div>
    </button>
  );
}

export function ChatSearchModal({ open, onOpenChange }: ChatSearchModalProps) {
  const navigate = useNavigate();
  const { mutateAsync } = useSearchChatMessages();
  const { data: animas = [] } = useAnimas({ enabled: open });
  const presentationsByAnimaId = useMemo(
    () =>
      new Map(animas.map((anima) => [anima.id, anima.presentation] as const)),
    [animas],
  );
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<PyChatSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setResponse(null);
    setIsSearching(false);
    setIsLoadingMore(false);
    setError(null);
    requestSeqRef.current += 1;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    if (normalized.length < 2) {
      setResponse(null);
      setError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void mutateAsync({
        query: normalized,
        limit: SEARCH_LIMIT,
        offset: 0,
      })
        .then((data) => {
          if (requestSeqRef.current !== requestSeq) return;
          setResponse(data);
        })
        .catch(() => {
          if (requestSeqRef.current !== requestSeq) return;
          setResponse(null);
          setError("Search failed.");
        })
        .finally(() => {
          if (requestSeqRef.current === requestSeq) {
            setIsSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [mutateAsync, open, query]);

  const handleSelect = useCallback(
    (result: PyChatSearchResult) => {
      if (!result.anima_id || !result.chat_id) return;
      onOpenChange(false);
      void navigate({
        to: "/a/$animaId/c/$chatId",
        params: {
          animaId: result.anima_id,
          chatId: result.chat_id,
        },
      });
    },
    [navigate, onOpenChange],
  );

  const handleLoadMore = useCallback(async () => {
    const current = response;
    const normalized = query.trim();
    if (!current?.has_more || normalized.length < 2 || isLoadingMore) return;

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setIsLoadingMore(true);
    setError(null);
    try {
      const next = await mutateAsync({
        query: normalized,
        limit: SEARCH_LIMIT,
        offset: current.results.length,
      });
      if (requestSeqRef.current !== requestSeq) return;
      setResponse({
        ...next,
        offset: 0,
        results: current.results.concat(next.results),
      });
    } catch {
      if (requestSeqRef.current === requestSeq) {
        setError("Search failed.");
      }
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setIsLoadingMore(false);
      }
    }
  }, [isLoadingMore, mutateAsync, query, response]);

  const results = response?.results ?? [];
  const showEmpty =
    query.trim().length >= 2 &&
    !isSearching &&
    !error &&
    response &&
    results.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "bg-popover/96 text-popover-foreground !top-[18vh] max-h-[min(64vh,34rem)] w-[min(48rem,calc(100vw-2rem))] !translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 ring-1 ring-white/10",
          "sm:max-w-[min(48rem,calc(100vw-2rem))]",
        )}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search chats</DialogTitle>
          <DialogDescription>Search persisted chat messages.</DialogDescription>
        </DialogHeader>
        <div className="border-border/70 grid grid-cols-[minmax(0,1fr)_3rem] items-center border-b px-5 py-4">
          <div className="relative min-w-0">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-0 size-5 -translate-y-1/2" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search chats"
              className="h-10 border-0 bg-transparent pr-3 pl-8 text-2xl shadow-none focus-visible:ring-0 md:text-2xl"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close search"
            className="justify-self-end"
          >
            <X className="size-5" />
          </Button>
        </div>

        <div className="max-h-[calc(min(64vh,34rem)-4.5rem)] overflow-y-auto py-1.5">
          {results.length > 0 ? (
            <div>
              {results.map((result) => (
                <ChatSearchResultRow
                  key={result.chat_id}
                  result={result}
                  presentation={presentationsByAnimaId.get(result.anima_id)}
                  query={query}
                  onSelect={handleSelect}
                />
              ))}
              {response?.has_more ? (
                <div className="px-6 py-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          ) : isSearching ? (
            <div className="text-muted-foreground flex items-center gap-2 px-6 py-10 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Searching...
            </div>
          ) : error ? (
            <div className="text-destructive px-6 py-10 text-sm">{error}</div>
          ) : showEmpty ? (
            <div className="text-muted-foreground px-6 py-10 text-sm">
              No matching messages.
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
