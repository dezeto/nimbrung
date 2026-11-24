import { Link } from "@tanstack/react-router";
import { ListMusic, Plus } from "lucide-react";

import { SearchRow, SearchRowStatus } from "@/components/search-row";
import { useRowAdds } from "@/hooks/use-queue";
import { useSaved } from "@/hooks/use-saved";

// A few to pick from with one tap; the rest are a chip away in Search.
const SUGGESTED = 3;

/**
 * Up Next with nothing in it: says autoplay has it covered, offers a few of
 * this guest's saved songs, and invites the first add.
 */
export function EmptyQueue() {
  const { saved } = useSaved();
  const { add, statusOf } = useRowAdds();
  const picks = saved
    .filter((t) => ![SearchRowStatus.Playing, SearchRowStatus.Queued].includes(statusOf(t.videoId)))
    .slice(0, SUGGESTED);

  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)] justify-items-center gap-3 rounded-3xl border border-dashed border-[rgb(var(--nb-fg)/0.2)] px-4 py-8 text-center">
      <ListMusic className="size-6 t-2" />
      <div className="grid gap-1">
        <p className="text-sm font-medium">Nothing queued yet</p>
        <p className="text-[13px] t-2">Autoplay keeps the music going until someone adds a song.</p>
      </div>
      {picks.length > 0 && (
        <section aria-labelledby="suggested" className="w-full text-left">
          <h3 id="suggested" className="pt-1 text-[13px] font-semibold t-2">
            From your saved songs
          </h3>
          <ul className="list">
            {picks.map((track) => (
              <SearchRow
                key={track.videoId}
                track={track}
                status={statusOf(track.videoId)}
                error={add.error?.message}
                onAdd={() => add.mutate({ videoId: track.videoId })}
                saved={false}
              />
            ))}
          </ul>
        </section>
      )}
      <Link to="/search" className="btn-plain h-11">
        <Plus className="size-4" /> {picks.length > 0 ? "Find another song" : "Add the first song"}
      </Link>
    </div>
  );
}
