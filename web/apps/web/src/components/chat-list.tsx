import { cn } from "@web/ui/lib/utils";
import { MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";

import { type CommentEntry, type FeedEntry, FeedKind } from "@/api/client";
import { ActivityText } from "@/components/activity-text";

type Props = { feed: FeedEntry[]; meId: string; className?: string };

// Comments from one person closer together than this read as one run: their
// name once, bubbles stacked tight, the tail only on the last one.
const RUN_GAP_MS = 5 * 60_000;

const sameRun = (a: FeedEntry | undefined, b: FeedEntry | undefined) =>
  a?.kind === FeedKind.Comment &&
  b?.kind === FeedKind.Comment &&
  a.guestId === b.guestId &&
  Math.abs(Date.parse(b.at) - Date.parse(a.at)) < RUN_GAP_MS;

/** The room's last 20 comments and song activity, oldest at the top. */
export function ChatList({ feed, meId, className }: Props) {
  const now = useNow();
  // column-reverse around one list starts the scroll at the bottom and keeps
  // it on the newest line without any scrolling code; the DOM stays in
  // reading order for screen readers.
  return (
    <div
      role="log"
      aria-label="Messages"
      className={cn("chat-scroll flex max-h-60 flex-col-reverse overflow-y-auto overscroll-contain", className)}
    >
      {feed.length === 0 ? (
        <ChatEmpty />
      ) : (
        <ol className="chat-list px-1 py-3">
          {feed.map((entry, i) =>
            entry.kind === FeedKind.Comment ? (
              <Bubble
                key={entry.id}
                entry={entry}
                mine={entry.guestId === meId}
                first={!sameRun(feed[i - 1], entry)}
                last={!sameRun(entry, feed[i + 1])}
                now={now}
              />
            ) : (
              <li key={entry.id} className="chat-activity">
                <ActivityText entry={entry} />
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}

type BubbleProps = { entry: CommentEntry; mine: boolean; first: boolean; last: boolean; now: number };

/** One comment. Others get their face (or initial) beside a run's last bubble and their name over its first. */
function Bubble({ entry, mine, first, last, now }: BubbleProps) {
  return (
    <li
      aria-label={`${mine ? "You" : entry.name}: ${entry.text}`}
      className={cn("chat-msg", mine && "is-mine", !first && "is-joined", last && "is-last")}
    >
      {!mine && (
        <span aria-hidden className="chat-avatar" data-hidden={!last || undefined}>
          {entry.avatar ?? initial(entry.name)}
        </span>
      )}
      <div className="chat-col">
        {first && !mine && (
          <p className="chat-meta">
            <span className="truncate">{entry.name}</span>
            <time dateTime={entry.at}>{ago(entry.at, now)}</time>
          </p>
        )}
        <p className="chat-bubble" title={new Date(entry.at).toLocaleTimeString([], { timeStyle: "short" })}>
          {entry.text}
        </p>
      </div>
    </li>
  );
}

function ChatEmpty() {
  return (
    <div className="m-auto grid justify-items-center gap-1 px-8 py-8 text-center">
      <span className="mb-2 grid size-14 place-items-center rounded-full bg-[rgb(var(--nb-fg)/0.08)] t-2">
        <MessagesSquare className="size-6" />
      </span>
      <p className="text-[15px] font-semibold">No messages yet</p>
      <p className="text-sm text-balance t-2">Say hi, or tell the room what you think of this song.</p>
    </div>
  );
}

// First character, not first UTF-16 unit, so a name starting with an emoji keeps it whole.
const initial = (name?: string) => [...(name ?? "").trim()][0]?.toUpperCase() ?? "?";

/** "now", "4m", "2h", "1d": short enough to sit beside a name. */
function ago(at: string, now: number) {
  // Clamped: the server's clock can run a little ahead of the phone's.
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

/** The current time, refreshed often enough for minute-level labels. */
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
