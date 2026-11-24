import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { Search } from "lucide-react";
import { useRef, useState } from "react";

import { SearchKind, type Track } from "@/api/client";
import { AddSongHeader } from "@/components/add-song-header";
import { ArtistStrip } from "@/components/artist-strip";
import { MadeWith } from "@/components/made-with";
import { MiniPlayer } from "@/components/mini-player";
import { PasteLink } from "@/components/paste-link";
import { PlaylistRow } from "@/components/playlist-row";
import { RecentSearches } from "@/components/recent-searches";
import { SearchRow, SearchRowStatus } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { SongShelf } from "@/components/song-shelf";
import { useArtistSearch, useJamArtists } from "@/hooks/use-artists";
import { usePlayedTonight, useRowAdds, useSearch, useSuggestions } from "@/hooks/use-queue";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { useRoomState } from "@/hooks/use-room-state";
import { useSaved } from "@/hooks/use-saved";
import { requireGuest, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { playlistIdFromUrl } from "@/lib/links";

// A shelf is a taste, not a list: as many as a guest will swipe through.
const SHELF_SONGS = 8;
// Saved has a screen of its own; here it's the few most recent.
const SAVED_SHOWN = 3;

const isKind = (v: unknown): v is SearchKind => Object.values(SearchKind).includes(v as SearchKind);

/** Rows that read the same as another: same title, same artist. Their album tells them apart. */
function lookalikes(tracks: Track[]) {
  const key = (t: Track) => `${t.title}\n${t.artist}`.toLowerCase();
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
  return (t: Track) => (counts.get(key(t)) ?? 0) > 1;
}

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
  const [typing, setTyping] = useState(false);
  const [link, setLink] = useState("");
  const kind = search.type ?? SearchKind.Songs;
  const results = useSearch(input, kind);
  // Artists ride along with songs only: Videos and Playlists are their own asks.
  const artists = useArtistSearch(input, kind === SearchKind.Songs);
  const suggestions = useSuggestions(typing ? input : "");
  const room = useRoomState();
  const jamArtists = useJamArtists();
  const played = usePlayedTonight();
  useStillInTheJam();
  const { add, statusOf } = useRowAdds();
  const { saved, isSaved } = useSaved();
  const { recent, remember, forget } = useRecentSearches();
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

  function runSearch(q: string) {
    setInput(q);
    setSearch({ q });
  }
  // A suggestion is the whole search: run it and put the keyboard away.
  function onSuggest(q: string) {
    runSearch(q);
    remember(q);
    searchBox.current?.blur();
  }

  // The add's own state says which row or the link box it belongs to.
  const linkAdd = !!add.variables && "url" in add.variables;
  const linkPlaylistId = playlistIdFromUrl(link);
  // A playlist link opens the playlist to add from, like one found by search.
  function onAddLink() {
    if (linkPlaylistId) {
      navigate({ to: "/playlist/$playlistId", params: { playlistId: linkPlaylistId } });
      return;
    }
    add.mutate({ url: link }, { onSuccess: () => setLink("") });
  }

  const idle = input.trim().length < 2;
  const isOpen = (videoId: string) => statusOf(videoId) === SearchRowStatus.Add;
  const playedNote = (videoId: string) =>
    isOpen(videoId) && played.has(videoId) ? "played tonight" : undefined;
  // Autoplay's picks that aren't in the queue yet: the jam's taste, one tap away.
  const np = room?.nowPlaying;
  const alike = (room?.autoplay ?? []).filter((t) => t.videoId !== np?.videoId).slice(0, SHELF_SONGS);
  const tracks = results.data?.tracks ?? [];
  const isLookalike = lookalikes(tracks);

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <AddSongHeader
        current={kind}
        q={search.q}
        folded={input.length > 0}
        suggestions={typing && !idle ? suggestions : []}
        onSuggest={onSuggest}
      >
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
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            placeholder="Song, artist, or a line of lyrics"
            autoComplete="off"
            enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              remember(input);
              e.currentTarget.blur(); // the results are the point now, not the keyboard
            }}
            aria-label="Search songs"
          />
        </div>
      </AddSongHeader>

      <main className="flex-1 px-4 pb-28">
        {idle ? (
          <div className="flex flex-col gap-7 pt-1">
            {/* One artist is just the song that's playing; two or more is a jam's taste. */}
            {jamArtists.length > 1 && <ArtistStrip id="jam-artists" heading="In this jam" artists={jamArtists} />}
            <SongShelf
              id="alike"
              heading="More like what’s playing"
              sub={np ? [np.title, np.artist].filter(Boolean).join(" · ") : undefined}
              tracks={alike}
              statusOf={statusOf}
              error={add.error?.message}
              onAdd={(track) => add.mutate({ videoId: track.videoId })}
            />
            {saved.length > 0 && (
              <section aria-labelledby="saved-heading">
                <div className="flex items-center justify-between">
                  <h2 id="saved-heading" className="shelf-heading">
                    Saved
                  </h2>
                  {saved.length > SAVED_SHOWN && (
                    <Link to="/saved" className="flex min-h-9 items-center px-1 text-[13px] t-2">
                      All {saved.length}
                    </Link>
                  )}
                </div>
                <ul className="list">
                  {saved.slice(0, SAVED_SHOWN).map((track) => (
                    <SearchRow
                      key={track.videoId}
                      track={track}
                      status={statusOf(track.videoId)}
                      error={add.error?.message}
                      onAdd={() => add.mutate({ videoId: track.videoId })}
                      saved={false} // the heading already says so
                      note={playedNote(track.videoId)}
                    />
                  ))}
                </ul>
              </section>
            )}
            <RecentSearches recent={recent} onPick={runSearch} onClear={forget} />
            <PasteLink
              link={link}
              onLinkChange={setLink}
              onSubmit={onAddLink}
              opensPlaylist={!!linkPlaylistId}
              pending={add.isPending}
              error={linkAdd && add.isError ? add.error.message : undefined}
              added={linkAdd && add.isSuccess}
            />
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
          <div role="alert" className="grid justify-items-center gap-3 py-8 text-center text-sm t-2">
            <p className="first-letter:uppercase">{results.error.message}</p>
            <button type="button" onClick={() => results.refetch()} className="btn-plain">
              Try again
            </button>
          </div>
        ) : tracks.length === 0 && results.data?.playlists.length === 0 && artists.length === 0 ? (
          <p className="py-8 text-center text-sm t-2">Nothing found for “{input.trim()}”.</p>
        ) : (
          <div className={results.isPlaceholderData ? "opacity-60" : undefined}>
            {results.data?.correctedQuery && (
              <p className="pt-2 text-xs t-2">Showing results for “{results.data.correctedQuery}”</p>
            )}
            {artists.length > 0 && (
              <div className="pt-1 pb-4">
                <ArtistStrip id="found-artists" heading="Artists" artists={artists} />
              </div>
            )}
            {artists.length > 0 && tracks.length > 0 && <h2 className="shelf-heading">Songs</h2>}
            <ul className="list">
              {results.data?.playlists.map((playlist) => (
                <PlaylistRow key={playlist.id} playlist={playlist} q={input.trim()} />
              ))}
              {tracks.map((track) => (
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
                  showAlbum={isLookalike(track)}
                  note={playedNote(track.videoId)}
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
          </div>
        )}
        <MadeWith className="mt-10" />
      </main>
      <MiniPlayer />
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
