import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { ChevronLeft } from "lucide-react";

import { SearchKind } from "@/api/client";
import { MiniPlayer } from "@/components/mini-player";
import { PageHeader, backClass } from "@/components/page-header";
import { SearchRow, SearchRowStatus } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { usePlayedTonight, usePlaylist, useRowAdds } from "@/hooks/use-queue";
import { useSaved } from "@/hooks/use-saved";
import { requireGuest, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { MadeWith } from "@/components/made-with";

export const Route = createFileRoute("/playlist/$playlistId")({
  // q is the search this was opened from, so Back lands on the same results.
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === "string" && s.q ? { q: s.q } : {},
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: PlaylistScreen,
});

function PlaylistScreen() {
  const { playlistId } = Route.useParams();
  const { q } = Route.useSearch();
  const playlist = usePlaylist(playlistId);
  const { add, statusOf } = useRowAdds();
  const { isSaved } = useSaved();
  const played = usePlayedTonight();
  const navigate = useNavigate();
  useStillInTheJam();
  const back = { to: "/search", search: { q, type: SearchKind.Playlists } } as const;
  const shortcuts = useShortcuts([
    { shortcuts: [Shortcut.Back], label: "Back to the search", run: () => navigate(back) },
  ]);

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <PageHeader
        back={
          <Link {...back} aria-keyshortcuts={ariaShortcut(Shortcut.Back)} className={backClass}>
            <ChevronLeft className="size-5" /> Playlists
          </Link>
        }
      >
        {playlist.data ? (
          <h1 className="text-[26px] leading-8 font-bold tracking-[-0.025em] break-words text-balance">
            {playlist.data.title}
          </h1>
        ) : (
          <Skeleton className="h-7 w-2/3 rounded-full" />
        )}
      </PageHeader>

      <main className="flex flex-1 flex-col px-4 pb-28">
        {playlist.isPending ? (
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
        ) : playlist.isError ? (
          <div role="alert" className="grid justify-items-center gap-3 py-8 text-center text-sm t-2">
            <p className="first-letter:uppercase">{playlist.error.message}</p>
            <button type="button" onClick={() => playlist.refetch()} className="btn-plain">
              Try again
            </button>
          </div>
        ) : playlist.data.tracks.length === 0 ? (
          <p className="py-8 text-center text-sm t-2">
            No songs here. Private playlists can’t be opened.
          </p>
        ) : (
          <ul className="list">
            {playlist.data.tracks.map((track) => {
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
                />
              );
            })}
          </ul>
        )}
        <MadeWith className="mt-auto pt-10" />
      </main>
      <MiniPlayer />
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
