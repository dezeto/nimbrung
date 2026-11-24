import { Heart } from "lucide-react";

import { SearchRow } from "@/components/search-row";
import { useRowAdds } from "@/hooks/use-queue";
import { useSaved } from "@/hooks/use-saved";

/** The Saved tab under now playing: this phone's hearts, each a tap from the queue. */
export function SavedList() {
  const { saved, toggle } = useSaved();
  const { add, statusOf } = useRowAdds();

  if (saved.length === 0) {
    return (
      <p className="flex items-start gap-2 pt-2 text-[13px] t-2">
        <Heart className="mt-0.5 size-4 shrink-0" aria-hidden />
        Nothing saved yet. Tap the heart on any song to keep it here. The list stays on this phone,
        for the next jam too.
      </p>
    );
  }
  return (
    <ul className="list">
      {saved.map((track) => (
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
  );
}
