import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/ui/components/input";
import type { SectionIcon } from "@/ui/components/sectioned-modal-frame";
import {
  buildSettingsSearchOptions,
  splitHighlightedText,
  tokenizeSettingsQuery,
  type SettingsSearchEntry,
  type SettingsSearchOption,
} from "@/ui/settings/settings-search";

type SearchableEntry<Section extends string> = SettingsSearchEntry<Section> & {
  id: string;
};

type SettingsSearchProps<
  Section extends string,
  Entry extends SearchableEntry<Section>,
> = {
  /** Controlled so the owning dialog can clear the query on Esc before closing. */
  query: string;
  onQueryChange: (query: string) => void;
  entries: readonly Entry[];
  sections: readonly Section[];
  sectionIcons?: Partial<Record<Section, SectionIcon>>;
  onSelectSection: (section: Section) => void;
  onSelectEntry: (entry: Entry) => void;
};

function Highlighted({
  text,
  tokens,
}: {
  text: string;
  tokens: readonly string[];
}) {
  return splitHighlightedText(text, tokens).map((part, index) =>
    part.match ? (
      <span key={index} className="text-primary">
        {part.text}
      </span>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

/**
 * Search field whose matches, across every section, appear in a dropdown
 * beneath it. Arrow keys move through results and Enter selects.
 *
 * The dropdown renders in place (absolutely positioned, no portal) so it stays
 * inside the modal dialog's focus scope and dismissable layer.
 */
export function SettingsSearch<
  Section extends string,
  Entry extends SearchableEntry<Section>,
>({
  query,
  onQueryChange,
  entries,
  sections,
  sectionIcons,
  onSelectSection,
  onSelectEntry,
}: SettingsSearchProps<Section, Entry>) {
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef(new Map<string, HTMLElement>());
  const listId = useId();

  const tokens = tokenizeSettingsQuery(query);
  const open = focused && tokens.length > 0;
  const options = buildSettingsSearchOptions(entries, sections, tokens);
  const activeOption = options[activeIndex];
  const optionId = (option: SettingsSearchOption<Section, Entry>) =>
    `${listId}-${option.key}`;

  useEffect(() => {
    if (!open || !activeOption) return;
    optionRefs.current.get(activeOption.key)?.scrollIntoView({
      block: "nearest",
    });
  }, [open, activeOption]);

  const select = (option: SettingsSearchOption<Section, Entry>) => {
    onQueryChange("");
    if (option.kind === "section") onSelectSection(option.section);
    else onSelectEntry(option.entry);
  };

  return (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
      <Input
        type="search"
        role="combobox"
        aria-label="Search settings"
        aria-expanded={open}
        aria-controls={open && options.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeOption ? optionId(activeOption) : undefined
        }
        placeholder="Search"
        className="h-9 pl-8"
        value={query}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (!open || options.length === 0) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex(
              (index) => (index + step + options.length) % options.length,
            );
          } else if (event.key === "Enter" && activeOption) {
            event.preventDefault();
            select(activeOption);
          }
        }}
      />
      {open ? (
        <div className="bg-popover text-popover-foreground border-border absolute top-full left-0 z-20 mt-1.5 w-80 max-w-[calc(92vw-2rem)] rounded-lg border p-1 shadow-lg">
          {options.length === 0 ? (
            <p
              role="status"
              className="text-muted-foreground px-3 py-6 text-center text-sm"
            >
              No settings match &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <div
              id={listId}
              role="listbox"
              aria-label="Matching settings"
              className="max-h-[min(55vh,24rem)] overflow-y-auto"
            >
              {options.map((option, index) => {
                const Icon: SectionIcon | undefined =
                  option.kind === "section"
                    ? sectionIcons?.[option.section]
                    : undefined;
                return (
                  <div
                    key={option.key}
                    id={optionId(option)}
                    ref={(element) => {
                      if (element) optionRefs.current.set(option.key, element);
                      else optionRefs.current.delete(option.key);
                    }}
                    role="option"
                    aria-selected={index === activeIndex}
                    // Keep focus (and the open list) in the search input.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => select(option)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                      index === activeIndex && "bg-muted",
                      option.kind === "entry" && "pl-9",
                    )}
                  >
                    {Icon ? (
                      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                    ) : option.kind === "section" ? (
                      <span className="h-4 w-4 shrink-0" />
                    ) : null}
                    <span className="min-w-0 truncate">
                      <Highlighted
                        text={
                          option.kind === "section"
                            ? option.section
                            : option.entry.label
                        }
                        tokens={tokens}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
