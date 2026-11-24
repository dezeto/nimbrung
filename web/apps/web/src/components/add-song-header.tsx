import { Link } from "@tanstack/react-router";
import { ChevronLeft, Heart, Search } from "lucide-react";
import type { ReactNode } from "react";

import { SearchKind } from "@/api/client";
import { AddsLeft } from "@/components/adds-left";
import { Mnemonic } from "@/components/mnemonic";
import { Shortcut, ariaShortcut } from "@/hooks/use-shortcuts";

const chips: { kind: SearchKind; label: string }[] = [
  { kind: SearchKind.Songs, label: "Songs" },
  { kind: SearchKind.Videos, label: "Videos" },
  { kind: SearchKind.Playlists, label: "Playlists" },
];

type Props = {
  /** The chip that's on: a search kind, or "saved". */
  current: SearchKind | "saved";
  /** Carried over when switching chips, so the search survives. */
  q?: string;
  /** The field under the title. */
  children: ReactNode;
  /** Tucks the title away: there's a query, and the results want the room. */
  folded?: boolean;
  /** Ways to finish what's being typed. While there are any, they take the chips' row. */
  suggestions?: string[];
  onSuggest?: (q: string) => void;
};

/**
 * The top of Search and Saved: back, adds left, the field, and the chips.
 * Saved hangs off Search as a heart in the corner, and its back goes to
 * Search, so the words typed come along both ways.
 */
export function AddSongHeader({ current, q, children, folded, suggestions = [], onSuggest }: Props) {
  const onSaved = current === "saved";
  return (
    <header className="edge-top sticky top-0 z-10 grid gap-3 px-4 pt-2 pb-3">
      <div className="flex h-[52px] items-center justify-between gap-3">
        {onSaved ? (
          <Link
            to="/search"
            search={{ q }}
            replace
            aria-keyshortcuts={ariaShortcut(Shortcut.Back)}
            className="glass-btn is-capsule glass-rim h-11 gap-1 pr-4 pl-2.5"
          >
            <ChevronLeft className="size-5" /> Search
          </Link>
        ) : (
          <Link
            to="/"
            aria-keyshortcuts={`${ariaShortcut(Shortcut.Queue)} ${ariaShortcut(Shortcut.Back)}`}
            className="glass-btn is-capsule glass-rim h-11 gap-1 pr-4 pl-2.5"
          >
            <ChevronLeft className="size-5" /> <Mnemonic label="Queue" shortcut={Shortcut.Queue} />
          </Link>
        )}
        <div className="flex items-center gap-3">
          <AddsLeft />
          {!onSaved && (
            <Link
              to="/saved"
              search={{ q }}
              aria-label="Saved songs"
              title="Saved songs"
              className="glass-btn is-round glass-rim size-11"
            >
              <Heart className="size-5" aria-hidden />
            </Link>
          )}
        </div>
      </div>
      <div className="fold" data-folded={!!folded}>
        <h1 className="pl-1 text-[30px] leading-9 font-bold tracking-[-0.025em]">
          {onSaved ? "Saved songs" : "Add a song"}
        </h1>
      </div>
      {children}
      {suggestions.length > 0 ? (
        <ul aria-label="Suggestions" className="chips -mx-4 overflow-x-auto px-4">
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
      ) : !onSaved && (
      <nav aria-label="Search in" className="chips -mx-4 overflow-x-auto px-4">
        {chips.map(({ kind, label }) => (
          <Link
            key={kind}
            to="/search"
            search={{ q, type: kind === SearchKind.Songs ? undefined : kind }}
            replace
            resetScroll={false}
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
