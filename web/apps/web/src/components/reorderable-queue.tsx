import { cn } from "@web/ui/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import type { QueueItem, SongMove } from "@/api/client";
import { QueueRow } from "@/components/queue-row";

type Props = {
  queue: QueueItem[];
  meId: string;
  canRemove: (item: QueueItem) => boolean;
  removingId?: string;
  pendingMove?: SongMove;
  onRemove: (videoId: string) => void;
  onMove: (move: SongMove) => void;
  /** Seconds left of the song playing now, to say when each row starts. */
  nowLeft?: number;
};

/**
 * Up Next that anyone can reorder: ↑/↓ on each row (phones have no usable
 * drag), and drag-and-drop for mouse users.
 */
export function ReorderableQueue({
  queue,
  meId,
  canRemove,
  removingId,
  pendingMove,
  onRemove,
  onMove,
  nowLeft = 0,
}: Props) {
  const [dragFrom, setDragFrom] = useState<number>();
  const [dragOver, setDragOver] = useState<number>();
  // Show an in-flight move as done, so the row doesn't jump back until the
  // server's snapshot catches up.
  const rows = pendingMove ? withMove(queue, pendingMove) : queue;

  // When each row starts: what's left of now playing plus every row above it.
  const startsIn = rows.map((_, i) =>
    rows.slice(0, i).reduce((sum, r) => sum + r.duration, nowLeft),
  );

  function move(from: number, to: number) {
    const song = rows[from];
    if (song && rows[to] && to !== from) onMove({ videoId: song.videoId, position: to });
  }

  function endDrag() {
    setDragFrom(undefined);
    setDragOver(undefined);
  }

  return (
    <ul className={cn("list has-handle", dragFrom !== undefined && "select-none")}>
      {rows.map((item, i) => {
        // Keyed by song, not queue index, so a moving row keeps its DOM node
        // and focus; the count keeps a song the player queued twice unique.
        const copies = rows.slice(0, i).filter((r) => r.videoId === item.videoId).length;
        return (
          <QueueRow
            key={`${item.videoId}-${copies}`}
            item={item}
            mine={item.addedById === meId}
            position={i + 1}
            startsIn={startsIn[i]}
            canRemove={canRemove(item)}
            removing={removingId === item.videoId}
            onRemove={() => onRemove(item.videoId)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.videoId); // Firefox won't drag without data
              setDragFrom(i);
              // The browser snapshots the row for the drag picture right after this
              // handler, so the card look goes on now and comes off next frame.
              const li = e.currentTarget;
              li.classList.add("is-lifted");
              requestAnimationFrame(() => li.classList.remove("is-lifted"));
            }}
            onDragOver={(e) => {
              if (dragFrom === undefined) return; // a file or link, not one of our rows
              e.preventDefault();
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== undefined) move(dragFrom, i);
              endDrag();
            }}
            onDragEnd={endDrag}
            className={cn(dragFrom === i && "opacity-50", dropLine(dragFrom, dragOver, i))}
            dragHandle={
              <div className="handle">
                {/* aria-disabled, not disabled: a song moved to the top keeps focus on
                    its ↑. move() ignores a step past either end. */}
                <button
                  type="button"
                  aria-label={`Move ${item.title} up`}
                  aria-disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${item.title} down`}
                  aria-disabled={i === rows.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            }
          />
        );
      })}
    </ul>
  );
}


function withMove(queue: QueueItem[], { videoId, position }: SongMove) {
  const song = queue.find((q) => q.videoId === videoId);
  return song ? queue.filter((q) => q !== song).toSpliced(position, 0, song) : queue;
}

// The line sits where the song will land: above the row when moving up, below it when moving down.
function dropLine(from: number | undefined, over: number | undefined, i: number) {
  if (from === undefined || over !== i || over === from) return undefined;
  return from > over
    ? "shadow-[inset_0_2px_0_var(--color-primary)]"
    : "shadow-[inset_0_-2px_0_var(--color-primary)]";
}
