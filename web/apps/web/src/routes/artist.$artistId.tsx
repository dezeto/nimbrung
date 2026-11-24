import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { ChevronLeft, UserRound } from "lucide-react";

import { ApiError, HttpStatus } from "@/api/client";
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

export const Route = createFileRoute("/artist/$artistId")({
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: ArtistScreen,
});

function ArtistScreen() {
  const { artistId } = Route.useParams();
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
  const shortcuts = useShortcuts([{ shortcuts: [Shortcut.Back], label: "Back", run: back }]);
  const songs = artist.data?.tracks.length ?? 0;

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
      >
        {!artist.isError && (
          <div className="flex items-center gap-3.5 pl-1">
            <span className="artist-face">
              {artist.data?.thumb ? (
                <img src={artist.data.thumb} alt="" className="size-full object-cover" />
              ) : (
                <UserRound className="size-7 t-2" aria-hidden />
              )}
            </span>
            {artist.data ? (
              <div className="min-w-0">
                <h1 className="line-clamp-2 text-[26px] leading-8 font-bold tracking-[-0.025em] break-words text-balance">
                  {artist.data.name}
                </h1>
                {songs > 0 && (
                  <p className="text-[13px] tabular-nums t-2">
                    {songs} {songs === 1 ? "song" : "songs"}, most played first
                  </p>
                )}
              </div>
            ) : (
              <Skeleton className="h-7 w-1/2 rounded-full" />
            )}
          </div>
        )}
      </PageHeader>

      <main className="flex-1 px-4 pb-28">
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
        ) : (
          <ul className="list">
            {artist.data.tracks.map((track) => {
              const status = statusOf(track.videoId);
              return (
                <SearchRow
                  key={track.videoId}
                  track={track}
                  status={status}
                  error={add.error?.message}
                  onAdd={() => add.mutate({ videoId: track.videoId })}
                  saved={isSaved(track.videoId)}
                  note={
                    status === SearchRowStatus.Add && played.has(track.videoId) ? "played tonight" : undefined
                  }
                  linkArtist={track.artistId !== artistId}
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
