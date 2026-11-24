import { Link, createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { ChevronLeft, Search, UserRound } from "lucide-react";
import { useRef, useState } from "react";

import { type Album, ApiError, HttpStatus } from "@/api/client";
import { AlbumStrip } from "@/components/album-strip";
import { MadeWith } from "@/components/made-with";
import { MiniPlayer } from "@/components/mini-player";
import { PageHeader, backClass } from "@/components/page-header";
import { SearchRow, SearchRowStatus } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { useArtist } from "@/hooks/use-artists";
import { usePlayedTonight, useRowAdds } from "@/hooks/use-queue";
import { useSaved } from "@/hooks/use-saved";
import { requireGuest, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { findMatch, matchesAny } from "@/lib/match";

/** Under an album on the artist's own page: the year, and what it is when it isn't an album. */
const albumSub = (album: Album) =>
  [album.kind && album.kind !== "Album" && album.kind, album.year].filter(Boolean).join(" · ");

export const Route = createFileRoute("/artist/$artistId")({
  // The filter lives in the URL, so Back from a song's artist or album keeps it.
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === "string" && s.q ? { q: s.q } : {},
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: ArtistScreen,
});

function ArtistScreen() {
  const { artistId } = Route.useParams();
  const search = Route.useSearch();
  // Typing stays local so the box never lags; the URL follows along.
  const [input, setInput] = useState(search.q ?? "");
  const artist = useArtist(artistId);
  const { add, statusOf } = useRowAdds();
  const { isSaved } = useSaved();
  const played = usePlayedTonight();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  useStillInTheJam();
  // Opened from a search, a playlist or Saved: back is wherever that was. A
  // link opened cold has nowhere to go back to, so it goes to Search.
  const back = () => (canGoBack ? router.history.back() : navigate({ to: "/search" }));
  const searchBox = useRef<HTMLInputElement>(null);
  const shortcuts = useShortcuts([
    { shortcuts: [Shortcut.Search], label: "Search their songs", run: () => searchBox.current?.focus() },
    { shortcuts: [Shortcut.Back], label: "Back", run: back },
  ]);
  const name = artist.data?.name ?? "";
  const tracks = artist.data?.tracks ?? [];
  const albums = artist.data?.albums ?? [];
  const songs = tracks.length;
  const filter = input.trim();
  const filtering = filter.length > 0 && songs > 0;
  // Their songs are all here already, so filtering needs no server: title or album, accents aside.
  const shown = filtering ? tracks.filter((t) => matchesAny([t.title, t.album], filter)) : tracks;
  // One of their songs: the album says which, the artist only when it's someone else's lead.
  // A plain function, not a component: a component made here would remount every row per keystroke.
  const songRow = (track: (typeof tracks)[number], mark?: [number, number]) => {
    const status = statusOf(track.videoId);
    return (
      <SearchRow
        key={track.videoId}
        track={track}
        status={status}
        error={add.error?.message}
        onAdd={() => add.mutate({ videoId: track.videoId })}
        saved={isSaved(track.videoId)}
        note={status === SearchRowStatus.Add && played.has(track.videoId) ? "played tonight" : undefined}
        showArtist={track.artistId !== artistId}
        showAlbum
        mark={mark}
      />
    );
  };
  const facts = [
    songs > 0 && `${songs} ${songs === 1 ? "song" : "songs"}`,
    albums.length > 0 && `${albums.length} ${albums.length === 1 ? "album" : "albums"}`,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <PageHeader
        end={
          filtering ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="artist-face size-7">
                {artist.data?.thumb && <img src={artist.data.thumb} alt="" className="size-full object-cover" />}
              </span>
              <p className="truncate text-[17px] leading-[22px] font-semibold">{name}</p>
            </div>
          ) : undefined
        }
        back={
          <button
            type="button"
            onClick={back}
            aria-keyshortcuts={ariaShortcut(Shortcut.Back)}
            className={backClass}
          >
            <ChevronLeft className="size-5" /> Back
          </button>
        }
      >
        {!artist.isError && (
          // Folds away while filtering; the name moves up beside Back.
          <div className="fold" data-folded={filtering}>
            <div className="flex items-center gap-3.5">
              <span className="artist-face size-[84px]">
                {artist.data?.thumb ? (
                  <img src={artist.data.thumb} alt="" className="size-full object-cover" />
                ) : (
                  <UserRound className="size-8 t-2" aria-hidden />
                )}
              </span>
              {artist.data ? (
                <div className="min-w-0">
                  <h1 className="line-clamp-2 text-[28px] leading-[34px] font-bold tracking-[-0.025em] break-words text-balance">
                    {name}
                  </h1>
                  {facts.length > 0 && <p className="text-[13px] tabular-nums t-2">{facts.join(" · ")}</p>}
                </div>
              ) : (
                <Skeleton className="h-7 w-1/2 rounded-full" />
              )}
            </div>
          </div>
        )}
        {songs > 0 && (
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
                navigate({
                  to: "/artist/$artistId",
                  params: { artistId },
                  search: { q: e.target.value || undefined },
                  replace: true,
                  resetScroll: false,
                });
              }}
              placeholder={`Search ${name}’s songs`}
              aria-label={`Search ${name}’s songs`}
              autoComplete="off"
              enterKeyHint="search"
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </div>
        )}
      </PageHeader>

      <main className="flex flex-1 flex-col px-4 pb-28">
        {artist.isPending ? (
          <ul aria-label="Loading songs…" aria-busy="true">
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
        ) : artist.error instanceof ApiError && artist.error.status === HttpStatus.NotFound ? (
          <p role="alert" className="py-8 text-center text-sm t-2">
            YouTube has no artist page here. Go back and search for the song by name.
          </p>
        ) : artist.isError ? (
          <div role="alert" className="grid justify-items-center gap-3 py-8 text-center text-sm t-2">
            <p className="first-letter:uppercase">{artist.error.message}</p>
            <button type="button" onClick={() => artist.refetch()} className="btn-plain">
              Try again
            </button>
          </div>
        ) : songs === 0 ? (
          <p className="py-8 text-center text-sm t-2">
            YouTube lists no songs for {artist.data.name}. Try searching for one by name.
          </p>
        ) : filtering ? (
          <>
            <p role="status" className="pb-1 text-[13px] tabular-nums t-2">
              {shown.length} of {songs} songs
            </p>
            <ul className="list">
              {shown.map((track) => songRow(track, findMatch(track.title, filter)))}
            </ul>
            {/* Not here? It may be on YouTube under their name. */}
            <Link
              to="/search"
              search={{ q: `${name} ${filter}` }}
              className="btn-plain mt-4 min-h-12 w-full gap-2 px-4 py-2 text-[15px] whitespace-normal text-balance"
            >
              <Search className="size-4 shrink-0" aria-hidden />
              Search all of YouTube for “{name} {filter}”
            </Link>
          </>
        ) : (
          <div className="flex flex-col gap-7 pt-1">
            <AlbumStrip id="artist-albums" heading="Albums" albums={albums} sub={albumSub} />
            <section aria-labelledby="most-played">
              <h2 id="most-played" className="shelf-heading">
                Most played
              </h2>
              <ul className="list pt-1">
                {tracks.map((track) => songRow(track))}
              </ul>
            </section>
          </div>
        )}
        <MadeWith className="mt-auto pt-10" />
      </main>
      <MiniPlayer />
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
