import { cn } from "@web/ui/lib/utils";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import type { QueueItem } from "@/api/client";
import { AutoplayMark } from "@/components/autoplay-mark";
import { formatDuration } from "@/lib/time";
import { who } from "@/lib/who";

// The li props and dragHandle are for the host's reorderable list; guests pass neither.
type Props = ComponentProps<"li"> & {
  item: QueueItem;
  mine: boolean;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
  dragHandle?: ReactNode;
  /** 1-based slot in Up next, and seconds until it plays; shown on the guest's own rows. */
  position?: number;
  startsIn?: number;
  /** Off in the Autoplay section, where every row is autoplay and the ∞ is noise. */
  markAutoplay?: boolean;
};

export function QueueRow({
  item,
  mine,
  canRemove,
  removing,
  onRemove,
  dragHandle,
  position,
  startsIn,
  markAutoplay = true,
  className,
  ...li
}: Props) {
  return (
    <li className={cn("row", mine && "is-mine", className)} {...li}>
      {dragHandle}
      <div className="thumb">
        {item.thumb && <img src={item.thumb} alt="" loading="lazy" className="size-full object-cover" />}
      </div>
      <div className="row-text">
        <p className="row-title">{item.title}</p>
        <p className="row-sub">
          {mine ? (
            <>
              <span className="t-mine">Yours</span>
              {position !== undefined && (
                <span className="tabular-nums">
                  {" · "}#{position}
                  {startsIn !== undefined && ` · ${whenItPlays(startsIn)}`}
                </span>
              )}
            </>
          ) : (
            <>
              {item.artist}
              {item.addedBy ? ` · ${who(item.addedBy, item.addedByAvatar)}` : markAutoplay && <> · <AutoplayMark /></>}
            </>
          )}
        </p>
      </div>
      {item.duration > 0 && (
        <span className="text-[13px] tabular-nums t-2">{formatDuration(item.duration)}</span>
      )}
      {canRemove && (
        <button
          type="button"
          className="icon-btn -mr-2.5 disabled:opacity-40"
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${item.title}`}
        >
          <X className="size-5" />
        </button>
      )}
    </li>
  );
}

// Rough on purpose: songs get skipped and moved, so minutes are all we promise.
function whenItPlays(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes < 1 ? "up next" : `about ${minutes} min`;
}
