import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@web/ui/components/button";
import { Skeleton } from "@web/ui/components/skeleton";
import { ArrowLeft } from "lucide-react";

import { SearchKind } from "@/api/client";
import { AddsLeft } from "@/components/adds-left";
import { SearchRow } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { usePlaylist, useRowAdds } from "@/hooks/use-queue";
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
  const navigate = useNavigate();
  useStillInTheJam();
  const back = { to: "/search", search: { q, type: SearchKind.Playlists } } as const;
  const shortcuts = useShortcuts([
    { shortcuts: [Shortcut.Back], label: "Back to the search", run: () => navigate(back) },
  ]);

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <header className="edge-top sticky top-0 z-10 grid gap-2 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <Link
            {...back}
            aria-keyshortcuts={ariaShortcut(Shortcut.Back)}
            className="-ml-2 flex items-center gap-1 p-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Playlists
          </Link>
          <div className="flex items-center gap-3">
            <AddsLeft />
          </div>
        </div>
        {playlist.data ? (
          <h1 className="text-lg font-semibold break-words text-balance">{playlist.data.title}</h1>
        ) : (
          <Skeleton className="h-6 w-2/3" />
        )}
      </header>

      <main className="flex-1 px-4 pb-8">
        {playlist.isPending ? (
          <ul aria-label="Loading songs…" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="size-12" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        ) : playlist.isError ? (
          <div role="alert" className="grid justify-items-center gap-3 py-8 text-center text-sm text-muted-foreground">
            <p className="first-letter:uppercase">{playlist.error.message}</p>
            <Button variant="outline" onClick={() => playlist.refetch()} className="h-9 px-4">
              Try again
            </Button>
          </div>
        ) : playlist.data.tracks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No songs here. Private playlists can’t be opened.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {playlist.data.tracks.map((track) => (
              <SearchRow
                key={track.videoId}
                track={track}
                status={statusOf(track.videoId)}
                error={add.error?.message}
                onAdd={() => add.mutate({ videoId: track.videoId })}
                saved={isSaved(track.videoId)}
              />
            ))}
          </ul>
        )}
        <MadeWith className="mt-10" />
      </main>
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
