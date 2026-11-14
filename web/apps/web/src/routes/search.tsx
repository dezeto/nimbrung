import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { Clock, Link2, Search } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

import { SearchKind } from "@/api/client";
import { AddSongHeader } from "@/components/add-song-header";
import { PlaylistRow } from "@/components/playlist-row";
import { MiniPlayer } from "@/components/mini-player";
import { SearchRow } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { useRowAdds, useSearch } from "@/hooks/use-queue";
import { useSaved } from "@/hooks/use-saved";
import { requireGuest, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { playlistIdFromUrl } from "@/lib/links";

// Recent searches live in this browser only, like Saved: no account.
const RECENT_KEY = "nimbrung.recent";
const RECENT_MAX = 8;
function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((q) => typeof q === "string") : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

const isKind = (v: unknown): v is SearchKind => Object.values(SearchKind).includes(v as SearchKind);

export const Route = createFileRoute("/search")({
  // The query and type live in the URL, so Back and reload keep the search.
  validateSearch: (s: Record<string, unknown>): { q?: string; type?: SearchKind } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    type: isKind(s.type) && s.type !== SearchKind.Songs ? s.type : undefined,
  }),
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: SearchScreen,
});

function SearchScreen() {
  const search = Route.useSearch();
  // Typing stays local so the box never lags; the URL follows along.
  const [input, setInput] = useState(search.q ?? "");
  const [link, setLink] = useState("");
  const kind = search.type ?? SearchKind.Songs;
  const results = useSearch(input, kind);
  useStillInTheJam();
  const { add, statusOf } = useRowAdds();
  const { isSaved } = useSaved();
  const [recent, setRecent] = useState(readRecent);
  const [linkOpen, setLinkOpen] = useState(false);
  // Remembered when the search was worth something: Enter, or a song added from it.
  function remember(q: string) {
    const text = q.trim();
    if (text.length < 2) return;
    const next = [text, ...recent.filter((r) => r.toLowerCase() !== text.toLowerCase())].slice(0, RECENT_MAX);
    setRecent(next);
    writeRecent(next);
  }
  function forgetRecent() {
    setRecent([]);
    writeRecent([]);
  }
  const navigate = useNavigate();
  const setSearch = (next: { q?: string; type?: SearchKind }) =>
    navigate({
      to: "/search",
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
      resetScroll: false,
    });
  const searchBox = useRef<HTMLInputElement>(null);
  const backToQueue = () => navigate({ to: "/" });
  const shortcuts = useShortcuts([
    {
      shortcuts: [Shortcut.Search],
      label: "Search",
      run: () => searchBox.current?.focus(),
    },
    {
      shortcuts: [Shortcut.Queue, Shortcut.Back],
      label: "Back to the queue",
      run: backToQueue,
    },
  ]);

  // The add's own state says which row or the link box it belongs to.
  const linkAdd = !!add.variables && "url" in add.variables;
  const linkPlaylistId = playlistIdFromUrl(link);

  // A playlist link opens the playlist to add from, like one found by search.
  function onAddLink(e: FormEvent) {
    e.preventDefault();
    if (linkPlaylistId) {
      navigate({
        to: "/playlist/$playlistId",
        params: { playlistId: linkPlaylistId },
      });
      return;
    }
    add.mutate({ url: link }, { onSuccess: () => setLink("") });
  }

  const idle = input.trim().length < 2;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <AddSongHeader current={kind} q={search.q}>
        <div className="glass-field">
          <Search className="size-5 shrink-0" aria-hidden />
          <input
            ref={searchBox}
            type="search"
            name="q"
            aria-keyshortcuts={ariaShortcut(Shortcut.Search)}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setSearch({ q: e.target.value || undefined });
            }}
            placeholder="Song, artist, or a line of lyrics"
            autoComplete="off"
            autoFocus
            enterKeyHint="search"
            onKeyDown={(e) => e.key === "Enter" && remember(input)}
            aria-label="Search songs"
          />
        </div>
      </AddSongHeader>

      <main className="flex-1 px-4 pb-28">
        {idle ? (
          <div className="flex flex-col gap-6 pt-1">
            {recent.length > 0 && (
              <section aria-labelledby="recent-heading">
                <div className="flex items-center justify-between px-1">
                  <h2 id="recent-heading" className="text-[17px] font-bold">
                    Recent searches
                  </h2>
                  <button type="button" onClick={forgetRecent} className="min-h-9 px-1 text-[13px] t-2">
                    Clear
                  </button>
                </div>
                <ul className="flex flex-wrap gap-2 pt-2">
                  {recent.map((q) => (
                    <li key={q} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          setInput(q);
                          setSearch({ q });
                        }}
                        className="chip max-w-full gap-1.5"
                      >
                        <Clock className="size-3.5 shrink-0 t-2" aria-hidden />
                        <span className="truncate">{q}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {linkOpen ? (
              <section className="section flex flex-col px-4 pb-4">
            <form onSubmit={onAddLink} className="flex flex-col gap-2.5 pt-3.5">
              <label htmlFor="link" className="flex items-center gap-2.5 text-[15px] font-semibold">
                <Link2 className="size-5 text-[var(--nb-accent-text)]" aria-hidden /> Got a link?
              </label>
              <p className="text-[13px] t-2">
                Paste a YouTube or YouTube Music link to a song or a playlist, or use Share →
                Nimbrung from the app.
              </p>
              <div className="mt-0.5 flex gap-2">
                <div className="field-inset min-w-0 flex-1">
                  <input
                    id="link"
                    type="url"
                    name="url"
                    required
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    spellCheck={false}
                    placeholder="https://music.youtube.com/watch?v=…"
                    className="text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={add.isPending}
                  className="btn-plain is-primary h-11 px-[18px] text-[15px]"
                >
                  {linkPlaylistId ? "Open" : linkAdd && add.isPending ? "Adding…" : "Add"}
                </button>
              </div>
              {linkAdd && add.isError && (
                <p role="alert" className="first-letter:uppercase text-xs t-mine">
                  {add.error.message}
                </p>
              )}
              {linkAdd && add.isSuccess && (
                <p role="status" className="text-xs t-2">
                  Added to the queue ✓
                </p>
              )}
            </form>
              </section>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="flex min-h-11 items-center gap-2 self-start px-1 text-[15px] font-medium t-2 hover:text-[var(--lg-ink)]"
              >
                <Link2 className="size-[18px]" aria-hidden /> Paste a link
              </button>
            )}
          </div>
        ) : results.isPending ? (
          <ul aria-label="Loading results…" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="size-12 rounded-[10px]" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        ) : results.isError && !results.isFetchNextPageError ? (
          <div
            role="alert"
            className="grid justify-items-center gap-3 py-8 text-center text-sm text-muted-foreground"
          >
            <p className="first-letter:uppercase">{results.error.message}</p>
            <button type="button" onClick={() => results.refetch()} className="btn-plain">
              Try again
            </button>
          </div>
        ) : results.data?.tracks.length === 0 && results.data.playlists.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing found for “{input.trim()}”.
          </p>
        ) : (
          <>
            {results.data?.correctedQuery && (
              <p className="pt-2 text-xs text-muted-foreground">
                Showing results for “{results.data.correctedQuery}”
              </p>
            )}
            <ul className={results.isPlaceholderData ? "list opacity-60" : "list"}>
              {results.data?.playlists.map((playlist) => (
                <PlaylistRow key={playlist.id} playlist={playlist} q={input.trim()} />
              ))}
              {results.data?.tracks.map((track) => (
                <SearchRow
                  key={track.videoId}
                  track={track}
                  status={statusOf(track.videoId)}
                  error={add.error?.message}
                  onAdd={() => {
                    remember(input);
                    add.mutate({ videoId: track.videoId });
                  }}
                  saved={isSaved(track.videoId)}
                />
              ))}
            </ul>
            {results.hasNextPage && (
              <button
                type="button"
                onClick={() => results.fetchNextPage()}
                disabled={results.isFetching}
                className="btn-plain mt-2 h-11 w-full"
              >
                {results.isFetchingNextPage ? "Loading…" : "More results"}
              </button>
            )}
            {results.isFetchNextPageError && (
              <p role="alert" className="first-letter:uppercase pt-2 text-center text-xs t-mine">
                {results.error.message}
              </p>
            )}
          </>
        )}
      </main>
      <MiniPlayer />
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
