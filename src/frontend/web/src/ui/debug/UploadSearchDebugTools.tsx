import { type FormEvent, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import type {
  PySearchMemoryFileDebugResult,
  PyUserFileSearchResult,
} from "@/lib/content/catalogTypes";
import { getUserFileErrorMessage } from "@/lib/user-files/uploads";
import { useDebugSearchMemoryFiles } from "@/query/mutations/useDebugSearchMemoryFiles";
import { useDebugUserFileSearch } from "@/query/mutations/useDebugUserFileSearch";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";

type SearchMode = "keyword" | "semantic" | "hybrid";

const SEARCH_MODES: SearchMode[] = ["hybrid", "keyword", "semantic"];
function SearchResultRow({ result }: { result: PyUserFileSearchResult }) {
  return (
    <div className="border-border/70 grid gap-3 border-t py-4 first:border-t-0 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_6rem]">
      <div className="min-w-0 space-y-1">
        <div className="text-foreground truncate text-sm font-medium">
          {result.original_filename}
        </div>
        <div className="text-muted-foreground text-xs">
          chunk {result.chunk_index} / {result.normalized_extension}
        </div>
      </div>
      <p className="text-foreground/90 line-clamp-4 text-sm leading-6">
        {result.text}
      </p>
      <div className="text-muted-foreground text-xs md:text-right">
        <div>{result.match_type}</div>
        <div>{result.score.toFixed(3)}</div>
      </div>
    </div>
  );
}

function MemoryToolMemoryResultRow({
  result,
}: {
  result: PySearchMemoryFileDebugResult;
}) {
  return (
    <div className="border-border/70 grid gap-3 border-t py-3 first:border-t-0 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-1">
        <div className="text-foreground truncate text-sm font-medium">
          {result.path}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {result.description ?? "No description"}
        </div>
      </div>
      <p className="text-foreground/90 line-clamp-3 text-sm leading-6">
        {result.snippet}
      </p>
    </div>
  );
}

/** Developer retrieval probes are separate from ordinary upload management. */
export default function UploadSearchDebugTools({
  selectedIds,
}: {
  selectedIds: string[];
}) {
  const [toolQuery, setToolQuery] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [limit, setLimit] = useState(10);
  const searchMemoryFiles = useDebugSearchMemoryFiles();
  const searchFiles = useDebugUserFileSearch();
  const memoryToolMemoryResults = searchMemoryFiles.data?.memory_results ?? [];
  const hasMemoryToolResults = memoryToolMemoryResults.length > 0;
  const searchResults = searchFiles.data?.results ?? [];

  const handleMemoryToolSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = toolQuery.trim();
    if (!trimmedQuery) {
      toast.error("Enter a search query.");
      return;
    }

    try {
      await searchMemoryFiles.mutateAsync({
        query: trimmedQuery,
      });
    } catch (error) {
      toast.error("Search failed.", {
        description: getUserFileErrorMessage(error),
      });
    }
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      toast.error("Enter a search query.");
      return;
    }

    try {
      await searchFiles.mutateAsync({
        query: trimmedQuery,
        mode,
        limit,
        file_ids: selectedIds.length > 0 ? selectedIds : undefined,
      });
    } catch (error) {
      toast.error("Search failed.", {
        description: getUserFileErrorMessage(error),
      });
    }
  };

  return (
    <>
      <section className="border-border/70 bg-card/80 rounded-lg border p-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Search className="size-5" />
            search_memory_files debug
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Search markdown memory files through the same compact result shape
            exposed to chat tools.
          </p>
        </div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={handleMemoryToolSearch}
        >
          <Input
            value={toolQuery}
            onChange={(event) => setToolQuery(event.target.value)}
            placeholder="Search memory files"
          />
          <Button type="submit" disabled={searchMemoryFiles.isPending}>
            {searchMemoryFiles.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </form>

        <div className="mt-5">
          {searchMemoryFiles.isPending ? (
            <div className="text-muted-foreground py-8 text-sm">
              Searching...
            </div>
          ) : searchMemoryFiles.isError ? (
            <div className="text-destructive py-8 text-sm">Search failed.</div>
          ) : searchMemoryFiles.data && !hasMemoryToolResults ? (
            <div className="text-muted-foreground py-8 text-sm">
              No memory-file results matched this query.
            </div>
          ) : hasMemoryToolResults ? (
            <div>
              <div>
                <div className="text-muted-foreground border-border/70 border-b pb-2 text-xs font-medium uppercase">
                  Memory files
                </div>
                {memoryToolMemoryResults.length > 0 ? (
                  memoryToolMemoryResults.map((result) => (
                    <MemoryToolMemoryResultRow
                      key={result.path}
                      result={result}
                    />
                  ))
                ) : (
                  <div className="text-muted-foreground py-5 text-sm">
                    No memory-file matches.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="border-border/70 bg-card/80 rounded-lg border p-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Search className="size-5" />
            Advanced chunk search
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {selectedIds.length > 0
              ? "Search is filtered to selected uploads."
              : "Search all processed uploads."}
          </p>
        </div>
        <form
          className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_7rem_auto]"
          onSubmit={handleSearch}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search uploaded chunks"
          />
          <Select
            value={mode}
            onValueChange={(value) => setMode(value as SearchMode)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_MODES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(event) => {
              const nextLimit = Number.parseInt(event.target.value, 10);
              setLimit(Number.isFinite(nextLimit) ? nextLimit : 10);
            }}
          />
          <Button type="submit" disabled={searchFiles.isPending}>
            {searchFiles.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </form>

        {searchFiles.data?.warnings?.length ? (
          <div className="border-border/70 bg-muted/30 text-muted-foreground mt-4 rounded-lg border p-3 text-sm">
            {searchFiles.data.warnings.join(" ")}
          </div>
        ) : null}

        <div className="mt-5">
          {searchFiles.isPending ? (
            <div className="text-muted-foreground py-8 text-sm">
              Searching...
            </div>
          ) : searchFiles.data && searchResults.length === 0 ? (
            <div className="text-muted-foreground py-8 text-sm">
              No chunks matched this query.
            </div>
          ) : searchResults.length > 0 ? (
            <div>
              {searchResults.map((result) => (
                <SearchResultRow key={result.chunk_id} result={result} />
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
