import { Infinity as InfinityIcon } from "lucide-react";

import type { QueueItem } from "@/api/client";
import { QueueRow } from "@/components/queue-row";
import { aboutMinutes } from "@/lib/queue";

// Enough to see where the music goes; the radio can run to 50 rows.
const SHOWN = 5;

type Props = {
  items: QueueItem[];
  /** Seconds until the first of them plays. */
  startsIn: number;
  /** Given to the host: autoplay rows can be taken out, never reordered. */
  onRemove?: (videoId: string) => void;
  removingId?: string;
};

/** YouTube's radio after Up next: read-only, cut short, marked once in the heading. */
export function AutoplayList({ items, startsIn, onRemove, removingId }: Props) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="autoplay">
      <h2
        id="autoplay"
        className="flex items-center gap-2 text-[17px] leading-[22px] font-semibold tracking-[-0.01em]"
      >
        Autoplay <InfinityIcon className="size-5 t-2" aria-hidden />
      </h2>
      <p className="pt-0.5 pb-1 text-[13px] t-2">
        Keeps the music going after Up next
        {startsIn > 60 && `, in about ${aboutMinutes(startsIn)}`}.
      </p>
      <ul className="list">
        {items.slice(0, SHOWN).map((item, i) => (
          <QueueRow
            key={`${item.videoId}-${i}`}
            item={item}
            mine={false}
            canRemove={!!onRemove}
            removing={removingId === item.videoId}
            onRemove={() => onRemove?.(item.videoId)}
            markAutoplay={false}
          />
        ))}
      </ul>
      {items.length > SHOWN && (
        <p className="pt-2 text-[13px] tabular-nums t-2">and {items.length - SHOWN} more</p>
      )}
    </section>
  );
}
