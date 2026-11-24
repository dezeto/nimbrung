import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Heart, Search } from "lucide-react";
import { useState } from "react";

import { AddSongHeader } from "@/components/add-song-header";
import { MiniPlayer } from "@/components/mini-player";
import { SearchRow } from "@/components/search-row";
import { ShortcutHelp } from "@/components/shortcut-help";
import { useRowAdds } from "@/hooks/use-queue";
import { useSaved } from "@/hooks/use-saved";
import { requireGuest, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { MadeWith } from "@/components/made-with";

export const Route = createFileRoute("/saved")({
  // Shares ?q= with Search, so switching chips keeps what was typed.
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: SavedScreen,
});

function SavedScreen() {
  const { saved, toggle } = useSaved();
  const { add, statusOf } = useRowAdds();
  const { q } = Route.useSearch();
  const [filter, setFilter] = useState(q ?? "");
  const navigate = useNavigate({ from: Route.fullPath });
  useStillInTheJam();
  const shortcuts = useShortcuts([
    { shortcuts: [Shortcut.Queue], label: "Back to the queue", run: () => navigate({ to: "/" }) },
    {
      shortcuts: [Shortcut.Back],
      label: "Back to search",
      run: () => navigate({ to: "/search", search: { q: filter.trim() || undefined } }),
    },
  ]);

  // The list lives on this phone, so filtering it is a plain substring match.
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? saved.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(needle))
    : saved;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      <AddSongHeader current="saved" q={filter.trim() || undefined}>
        <div className="glass-field">
          <Search className="size-5 shrink-0" aria-hidden />
          <input
            type="search"
            name="filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              navigate({ search: { q: e.target.value || undefined }, replace: true });
            }}
            placeholder="Search your saved songs"
            aria-label="Search your saved songs"
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
      </AddSongHeader>

      <main className="flex flex-1 flex-col px-4 pb-28">
        {saved.length === 0 ? (
          <p className="flex items-start gap-2 pt-1 text-[13px] t-2">
            <Heart className="mt-0.5 size-4 shrink-0" aria-hidden />
            Nothing saved yet. Tap the heart on any song to keep it here. The list stays on this
            phone, for the next jam too.
          </p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm t-2">No saved song matches “{filter.trim()}”.</p>
        ) : (
          <ul className="list">
            {shown.map((track) => (
              <SearchRow
                key={track.videoId}
                track={track}
                status={statusOf(track.videoId)}
                error={add.error?.message}
                onAdd={() => add.mutate({ videoId: track.videoId })}
                saved
                onSave={() => toggle(track)}
              />
            ))}
          </ul>
        )}
        <MadeWith className="mt-auto pt-10" />
      </main>
      <MiniPlayer />
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
