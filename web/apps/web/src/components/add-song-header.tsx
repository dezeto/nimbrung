import { Link } from "@tanstack/react-router";
import { ChevronLeft, Search } from "lucide-react";
import type { ReactNode } from "react";

import { SearchKind } from "@/api/client";
import { AddsLeft } from "@/components/adds-left";
import { Mnemonic } from "@/components/mnemonic";
import { Shortcut, ariaShortcut } from "@/hooks/use-shortcuts";

const chips: { kind: SearchKind; label: string }[] = [
  { kind: SearchKind.Songs, label: "Songs" },
  { kind: SearchKind.Videos, label: "Videos" },
  { kind: SearchKind.Albums, label: "Albums" },
  { kind: SearchKind.Playlists, label: "Playlists" },
];

type Props = {
  /** The chip that's on. */
  current: SearchKind;
  /** Carried over when switching chips, so the search survives. */
  q?: string;
  /** The field under the title. */
  children: ReactNode;
  /** Tucks the title away: there's a query, and the results want the room. */
  folded?: boolean;
  /** Ways to finish what's being typed. While there are any, they take the chips' row. */
  suggestions?: string[];
  onSuggest?: (q: string) => void;
  /** False when the box holds a link: there's nothing to search in. */
  showChips?: boolean;
};

/** The top of Search: back to the queue, adds left, the field, and the chips. */
export function AddSongHeader({
  current,
  q,
  children,
  folded,
  suggestions = [],
  onSuggest,
  showChips = true,
}: Props) {
  return (
    <header className="edge-top sticky top-0 z-10 grid gap-3 px-4 pt-2 pb-3">
      <div className="flex h-[52px] items-center justify-between gap-3">
        <Link
          to="/"
          aria-keyshortcuts={`${ariaShortcut(Shortcut.Queue)} ${ariaShortcut(Shortcut.Back)}`}
          className="glass-btn is-capsule glass-rim h-11 gap-1 pr-4 pl-2.5"
        >
          <ChevronLeft className="size-5" /> <Mnemonic label="Queue" shortcut={Shortcut.Queue} />
        </Link>
        <AddsLeft />
      </div>
      <div className="fold" data-folded={!!folded}>
        <h1 className="text-[30px] leading-9 font-bold tracking-[-0.025em]">
          Add a song
        </h1>
      </div>
      {children}
      {suggestions.length > 0 ? (
        <ul aria-label="Suggestions" className="chips -mx-4 overflow-x-auto px-4 min-[28rem]:mx-0 min-[28rem]:px-0">
          {suggestions.map((suggestion) => (
            <li key={suggestion} className="flex-none">
              <button
                type="button"
                className="chip gap-1.5"
                // Keeps the keyboard up until the tap lands: a blur first would swap this row back.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSuggest?.(suggestion)}
              >
                <Search className="size-3.5 shrink-0 t-2" aria-hidden />
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : showChips && (
      <nav aria-label="Search in" className="chips -mx-4 overflow-x-auto px-4 min-[28rem]:mx-0 min-[28rem]:px-0">
        {chips.map(({ kind, label }) => (
          <Link
            key={kind}
            to="/search"
            search={{ q, type: kind === SearchKind.Songs ? undefined : kind }}
            replace
            resetScroll={false}
            // Songs has no type in the URL; without this the router calls it active on every chip.
            activeOptions={{ explicitUndefined: true }}
            aria-current={kind === current ? "page" : undefined}
            className="chip"
          >
            {label}
          </Link>
        ))}
      </nav>
      )}
    </header>
  );
}
