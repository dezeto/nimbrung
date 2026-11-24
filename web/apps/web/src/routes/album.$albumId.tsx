import { Link, createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { ChevronLeft, Disc3 } from "lucide-react";

import { ApiError, HttpStatus, type Track } from "@/api/client";
import { MadeWith } from "@/components/made-with";
import { MiniPlayer } from "@/components/mini-player";
import { PageHeader, backClass } from "@/components/page-header";
import { SearchRow, SearchRowStatus } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { useAlbum } from "@/hooks/use-albums";
import { usePlayedTonight, useRowAdds } from "@/hooks/use-queue";
import { useSaved } from "@/hooks/use-saved";
import { requireGuest, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";

export const Route = createFileRoute("/album/$albumId")({
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: AlbumScreen,
});

/** "10 songs · 38 min": how long the album runs, to the minute. */
function albumLength(tracks: Track[]) {
  const songs = `${tracks.length} ${tracks.length === 1 ? "song" : "songs"}`;
  const minutes = Math.round(tracks.reduce((sum, t) => sum + t.duration, 0) / 60);
  if (minutes === 0) return songs;
  const time = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  return `${songs} · ${time}`;
}

function AlbumScreen() {
  const { albumId } = Route.useParams();
  const album = useAlbum(albumId);
  const { add, statusOf } = useRowAdds();
  const { isSaved } = useSaved();
  const played = usePlayedTonight();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  useStillInTheJam();
  // Opened from a search, an artist or a link: back is wherever that was. A
  // link opened cold has nowhere to go back to, so it goes to Search.
  const back = () => (canGoBack ? router.history.back() : navigate({ to: "/search" }));
  const shortcuts = useShortcuts([{ shortcuts: [Shortcut.Back], label: "Back", run: back }]);
  const tracks = album.data?.tracks ?? [];

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <PageHeader
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
      />

      <main className="flex-1 px-4 pb-28">
        {/* The cover scrolls away with the page: pinned, it would take half the screen from the songs. */}
        {album.isPending ? (
          <div className="flex items-end gap-4 pt-1 pb-5 pl-1" aria-busy="true" aria-label="Loading the album…">
            <Skeleton className="cover" />
            <div className="grid flex-1 gap-2.5 pb-1">
              <Skeleton className="h-3 w-1/3 rounded-full" />
              <Skeleton className="h-6 w-4/5 rounded-full" />
              <Skeleton className="h-3 w-1/2 rounded-full" />
            </div>
          </div>
        ) : album.data ? (
          <div className="flex items-end gap-4 pt-1 pb-5 pl-1">
            <div className="cover grid place-items-center">
              {album.data.thumb ? (
                <img src={album.data.thumb} alt="" className="size-full object-cover" />
              ) : (
                <Disc3 className="size-10 t-2" aria-hidden />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1 pb-1">
              <p className="kicker tabular-nums">
                {[album.data.kind || "Album", album.data.year].filter(Boolean).join(" · ")}
              </p>
              <h1 className="line-clamp-3 text-[26px] leading-[31px] font-bold tracking-[-0.025em] break-words text-balance">
                {album.data.title}
              </h1>
              {album.data.artistId ? (
                <Link
                  to="/artist/$artistId"
                  params={{ artistId: album.data.artistId }}
                  className="album-artist"
                >
                  <span className="block truncate">{album.data.artist}</span>
                </Link>
              ) : (
                album.data.artist && <p className="truncate text-[15px] font-[550]">{album.data.artist}</p>
              )}
              {tracks.length > 0 && <p className="text-[13px] tabular-nums t-2">{albumLength(tracks)}</p>}
            </div>
          </div>
        ) : null}

        {album.isPending ? (
          <ul aria-label="Loading songs…" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="size-7 rounded-full" />
                <div className="grid flex-1 gap-2 py-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : album.error instanceof ApiError && album.error.status === HttpStatus.NotFound ? (
          <p role="alert" className="py-8 text-center text-sm t-2">
            YouTube has no album here. Go back and search for the song by name.
          </p>
        ) : album.isError ? (
          <div role="alert" className="grid justify-items-center gap-3 py-8 text-center text-sm t-2">
            <p className="first-letter:uppercase">{album.error.message}</p>
            <button type="button" onClick={() => album.refetch()} className="btn-plain">
              Try again
            </button>
          </div>
        ) : tracks.length === 0 ? (
          <p className="py-8 text-center text-sm t-2">
            YouTube lists no songs on {album.data.title}. Try searching for one by name.
          </p>
        ) : (
          <ul className="list">
            {tracks.map((track, i) => {
              const status = statusOf(track.videoId);
              return (
                <SearchRow
                  key={track.videoId}
                  track={track}
                  trackNo={i + 1}
                  status={status}
                  error={add.error?.message}
                  onAdd={() => add.mutate({ videoId: track.videoId })}
                  saved={isSaved(track.videoId)}
                  // The header says who it's by; a guest on one song still gets named.
                  showArtist={track.artist !== album.data.artist}
                  note={
                    status === SearchRowStatus.Add && played.has(track.videoId) ? "played tonight" : undefined
                  }
                />
              );
            })}
          </ul>
        )}
        <MadeWith className="mt-10" />
      </main>
      <MiniPlayer />
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
