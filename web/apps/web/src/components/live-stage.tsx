import type { CSSProperties, ReactNode } from "react";

import { ActivityText } from "@/components/activity-text";
import { REACTION_LOOKS } from "@/components/reaction-bar";
import type { LiveMoments } from "@/hooks/use-live";
import { who } from "@/lib/who";

type Props = LiveMoments & { children: ReactNode };

// Comments slide along one of these lanes across the upper screen, top down.
// A comment's seq picks its lane, so it never jumps when an older one leaves;
// there are as many lanes as comments allowed on screen at once (MAX_SLIDING
// in hooks/use-live.ts).
const LANES = 4;

// Golden-ratio steps land each streak far from the last few, so different
// emoji spread across the screen instead of stacking up. Each tap in a streak
// starts a little off its spot and drifts its own way (--drift in index.css),
// so spam fans out like a fountain instead of rising as one tower.
const golden = (n: number) => (n * 0.618) % 1;
const floatStyle = (anchor: number, seq: number) =>
  ({
    left: `${14 + golden(anchor) * 66 + (golden(seq) - 0.5) * 6}%`,
    "--drift": `${(golden(seq * 7) - 0.5) * 7}rem`,
  }) as CSSProperties;

/**
 * Whatever is passed as children (the now-playing card) with the room's live
 * moments: reactions float up and comments slide across the whole screen,
 * and one quiet line of song activity sits at the card's bottom. Both layers
 * ignore taps, so they never cover a button, and are hidden from screen
 * readers; the Chat list is the readable record.
 */
export function LiveStage({ reactions, comments, activity, children }: Props) {
  return (
    <div className="relative">
      {children}
      <div aria-hidden className="live-stage pointer-events-none absolute inset-0 overflow-hidden">
        {activity && (
          <p
            key={activity.entry.id}
            // Same family as the toasts: an elevated glass pill, centred near the top of the art.
            className="live-fade absolute top-3 left-1/2 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--lg-border-color)] bg-[var(--lg-bg-elevated)] px-3.5 py-1.5 text-[13px] text-[var(--lg-ink)] shadow-[var(--lg-shadow-high)] backdrop-blur-xl"
          >
            <ActivityText entry={activity.entry} count={activity.count} />
          </p>
        )}
      </div>
      {/* The whole screen, minus the sticky "Add a song" bar the floats rise from. */}
      <div
        aria-hidden
        className="live-stage pointer-events-none fixed inset-x-0 top-0 bottom-24 z-40 overflow-hidden"
      >
        {comments.map(({ seq, value }) => (
          <p
            key={`comment-${seq}`}
            className="live-slide absolute left-0 grid rounded-[18px] bg-[rgb(var(--nb-shade)/0.72)] shadow-[inset_0_0_0_1px_rgb(var(--nb-fg)/0.16)] backdrop-blur-md px-3.5 py-1.5 whitespace-nowrap"
            style={{ top: `${10 + (seq % LANES) * 11}%` }}
          >
            {/* Who on a small line of its own, so a name never reads as part of the message. */}
            <span className="text-[11px] leading-4 font-semibold t-2">{who(value.name, value.avatar)}</span>
            <span className="text-[15px] leading-5">{value.text}</span>
          </p>
        ))}
        {reactions.map(({ seq, value: { reaction, anchor, name } }) => (
          <span
            key={`reaction-${seq}`}
            className="live-float absolute bottom-0 flex flex-col items-center gap-0.5"
            style={floatStyle(anchor, seq)}
          >
            <span className="text-4xl leading-none">{REACTION_LOOKS[reaction].emoji}</span>
            {name && (
              <span className="max-w-24 truncate rounded-full bg-[rgb(var(--nb-shade)/0.72)] shadow-[inset_0_0_0_1px_rgb(var(--nb-fg)/0.16)] backdrop-blur-md px-1.5 text-[10px]">
                {name}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
