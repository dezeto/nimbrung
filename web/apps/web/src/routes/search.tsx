import { useIsFetching } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { Link as LinkIcon, Search } from "lucide-react";
import { useRef, useState } from "react";

import { type Album, SearchKind, type Track } from "@/api/client";
import { AddSongHeader } from "@/components/add-song-header";
import { AlbumRow } from "@/components/album-row";
import { AlbumStrip } from "@/components/album-strip";
import { ArtistStrip } from "@/components/artist-strip";
import { LinkCard } from "@/components/link-card";
import { MadeWith } from "@/components/made-with";
import { MiniPlayer } from "@/components/mini-player";
import { PlaylistRow } from "@/components/playlist-row";
import { RecentSearches } from "@/components/recent-searches";
import { SearchRow, SearchRowStatus } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { SongShelf } from "@/components/song-shelf";
import { VideoShelf } from "@/components/video-shelf";
import { useAlbum, useAlbumStrip, useLikePlaying, useLinkedTrack, useVideoStrip } from "@/hooks/use-albums";
import { QueryKey } from "@/hooks/query-keys";
import { useArtistSearch, useJamArtists } from "@/hooks/use-artists";
import { usePlayedTonight, usePlaylist, useRowAdds, useSearch, useSuggestions } from "@/hooks/use-queue";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { useRoomState } from "@/hooks/use-room-state";
import { useSaved } from "@/hooks/use-saved";
import { requireGuest, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { LinkKind, readLink } from "@/lib/links";
import { formatDuration } from "@/lib/time";

// A shelf is a taste, not a list: as many as a guest will swipe through.
const SHELF_SONGS = 8;

const isKind = (v: unknown): v is SearchKind => Object.values(SearchKind).includes(v as SearchKind);

/** Rows that read the same as another: same title, same artist. Their album tells them apart. */
function lookalikes(tracks: Track[]) {
  const key = (t: Track) => `${t.title}\n${t.artist}`.toLowerCase();
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
  return (t: Track) => (counts.get(key(t)) ?? 0) > 1;
}

/** What a pasted link turned out to be, for its card; empty until YouTube answers. */
function linkPreview(
  track: Track | undefined,
  album: Album | undefined,
  playlistTitle: string | undefined,
): { title?: string; sub?: string; thumb?: string } {
  if (track) {
    const length = track.duration > 0 ? formatDuration(track.duration) : "";
    return { title: track.title, sub: [track.artist, track.album, length].filter(Boolean).join(" · "), thumb: track.thumb };
  }
  if (album) {
    return {
      title: album.title,
      sub: [album.kind || "Album", album.artist, album.year].filter(Boolean).join(" · "),
      thumb: album.thumb,
    };
  }
  return playlistTitle ? { title: playlistTitle, sub: "Playlist" } : {};
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
  // A link the guest asked to search as words after all.
  const [asWords, setAsWords] = useState<string>();
  const kind = search.type ?? SearchKind.Songs;
  // A link in the box isn't searched: it's looked up and offered as one card.
  const link = input === asWords ? undefined : readLink(input);
  const query = link ? "" : input;
  const results = useSearch(query, kind);
  // Artists, albums and videos ride along with songs only; on their own chip
  // they're the list. Each is its own ask, so none holds up the songs.
  const onSongs = kind === SearchKind.Songs;
  const artists = useArtistSearch(query, onSongs);
  const albumStrip = useAlbumStrip(query, onSongs);
  const videoStrip = useVideoStrip(query, onSongs);
  const suggestions = useSuggestions(typing ? query : "");
  const linkedTrack = useLinkedTrack(link?.kind === LinkKind.Song ? link.videoId : undefined);
  const linkedAlbum = useAlbum(link?.kind === LinkKind.Album ? link.albumId : undefined);
  const linkedPlaylist = usePlaylist(link?.kind === LinkKind.Playlist ? link.playlistId : undefined);
  const room = useRoomState();
  const jamArtists = useJamArtists();
  const played = usePlayedTonight();
  useStillInTheJam();
  const { add, statusOf } = useRowAdds();
  const { isSaved } = useSaved();
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

  // The add's own state says whether it was this link's.
  const url = input.trim();
  const linkAdd = !!add.variables && "url" in add.variables && add.variables.url === url;
  const linkSongStatus = link?.kind === LinkKind.Song ? statusOf(link.videoId) : SearchRowStatus.Add;
  const linkStatus =
    linkSongStatus !== SearchRowStatus.Add || !linkAdd
      ? linkSongStatus
      : add.isPending
        ? SearchRowStatus.Adding
        : add.isError
          ? SearchRowStatus.Failed
          : SearchRowStatus.Add;
  const linked = linkPreview(linkedTrack.data, linkedAlbum.data, linkedPlaylist.data?.title);

  const idle = query.trim().length < 2;
  const isOpen = (videoId: string) => statusOf(videoId) === SearchRowStatus.Add;
  const playedNote = (videoId: string) =>
    isOpen(videoId) && played.has(videoId) ? "played tonight" : undefined;
  // Songs like the one playing, not queued yet: one tap away.
  const np = room?.nowPlaying;
  const alike = useLikePlaying(SHELF_SONGS);
  const tracks = results.data?.tracks ?? [];
  const playlists = results.data?.playlists ?? [];
  const albums = results.data?.albums ?? [];
  const isLookalike = lookalikes(tracks);
  const hasStrips = artists.length + albumStrip.length + videoStrip.length > 0;
  // A strip still asking may yet find something: no "Nothing found" until they've all answered.
  const stripsAsking =
    useIsFetching({
      predicate: (q) =>
        (q.queryKey[0] === QueryKey.Search && q.queryKey[1] !== kind) || q.queryKey[0] === QueryKey.ArtistSearch,
    }) > 0;
  const nothingFound = tracks.length + playlists.length + albums.length === 0 && !hasStrips && !stripsAsking;
  const addFound = (track: Track) => {
    remember(input);
    add.mutate({ videoId: track.videoId });
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <AddSongHeader
        current={kind}
        q={search.q}
        folded={input.length > 0}
        suggestions={typing && !idle ? suggestions : []}
        onSuggest={onSuggest}
        // Chips narrow results; before a query there are none, so they wait for one.
        showChips={!link && !idle}
      >
        <div className="glass-field">
          {link ? (
            <LinkIcon className="size-5 shrink-0 text-[var(--nb-accent)]" aria-hidden />
          ) : (
            <Search className="size-5 shrink-0" aria-hidden />
          )}
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
            placeholder="Song, artist, or a link"
            autoComplete="off"
            enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (!link) remember(input);
              e.currentTarget.blur(); // the results are the point now, not the keyboard
            }}
            aria-label="Search songs"
          />
        </div>
      </AddSongHeader>

      <main className="flex flex-1 flex-col px-4 pb-28">
        {link ? (
          <div className="pt-1">
            <LinkCard
              link={link}
              url={url}
              {...linked}
              status={linkStatus}
              added={linkAdd && add.isSuccess}
              error={add.error?.message}
              onAdd={() => add.mutate({ url })}
              onSearchAnyway={() => setAsWords(input)}
            />
            {link.kind === LinkKind.Song && (
              <p className="pt-3.5 text-[13px] t-2">
                Tip: in YouTube Music, Share → Nimbrung adds a song without copying the link.
              </p>
            )}
          </div>
        ) : idle ? (
          <div className="flex flex-col gap-7 pt-1">
            {/* Right under the box, where the suggestions sit while typing. */}
            <RecentSearches recent={recent} onPick={runSearch} onClear={forget} />
            {/* One artist is just the song that's playing; two or more is a jam's taste. */}
            {jamArtists.length > 1 && <ArtistStrip id="jam-artists" heading="In this jam" artists={jamArtists} />}
            <SongShelf
              id="alike"
              // The song itself is in the mini player below; the heading only says whose it is.
              heading={np?.artist ? `Like ${np.artist}` : "Like what’s playing"}
              tracks={alike}
              statusOf={statusOf}
              error={add.error?.message}
              onAdd={(track) => add.mutate({ videoId: track.videoId })}
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
        ) : nothingFound ? (
          <p className="py-8 text-center text-sm t-2">Nothing found for “{query.trim()}”.</p>
        ) : (
          <div className={results.isPlaceholderData ? "opacity-60" : undefined}>
            {results.data?.correctedQuery && (
              <p className="pt-2 text-xs t-2">Showing results for “{results.data.correctedQuery}”</p>
            )}
            {hasStrips && (
              <div className="flex flex-col gap-7 pt-1 pb-7">
                <ArtistStrip id="found-artists" heading="Artists" artists={artists} />
                <AlbumStrip
                  id="found-albums"
                  heading="Albums"
                  albums={albumStrip}
                  sub={(album) => [album.artist, album.year].filter(Boolean).join(" · ")}
                  seeAll={{ to: "/search", search: { q: search.q, type: SearchKind.Albums }, replace: true }}
                />
                <VideoShelf
                  id="found-videos"
                  heading="Videos"
                  videos={videoStrip}
                  statusOf={statusOf}
                  error={add.error?.message}
                  onAdd={addFound}
                  seeAll={{ to: "/search", search: { q: search.q, type: SearchKind.Videos }, replace: true }}
                />
              </div>
            )}
            {hasStrips && tracks.length > 0 && <h2 className="shelf-heading">Songs</h2>}
            <ul className="list">
              {playlists.map((playlist) => (
                <PlaylistRow key={playlist.id} playlist={playlist} q={input.trim()} />
              ))}
              {albums.map((album) => (
                <AlbumRow key={album.id} album={album} />
              ))}
              {tracks.map((track) => (
                <SearchRow
                  key={track.videoId}
                  track={track}
                  status={statusOf(track.videoId)}
                  error={add.error?.message}
                  onAdd={() => addFound(track)}
                  saved={isSaved(track.videoId)}
                  showAlbum={isLookalike(track)}
                  note={playedNote(track.videoId)}
                  wide={kind === SearchKind.Videos}
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
        <MadeWith className="mt-auto pt-10" />
      </main>
      <MiniPlayer />
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
