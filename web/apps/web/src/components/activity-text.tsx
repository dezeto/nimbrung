import {
  ArrowUpDown,
  ListMinus,
  ListPlus,
  Shuffle,
  type LucideIcon,
  SkipForward,
  UserMinus,
} from "lucide-react";

import { type ActivityEntry, type ActivityKind, FeedKind } from "@/api/client";
import { who } from "@/lib/who";

type Wording = {
  icon: LucideIcon;
  one: (e: ActivityEntry) => string;
  burst: (e: ActivityEntry, count: number) => string; // count in a row by the same guest
};

// Titles can come back empty when YouTube changes its layout (see ytm/parse.go).
const song = (e: ActivityEntry) => e.title || "a song";

const WORDING: Record<ActivityKind, Wording> = {
  [FeedKind.Added]: {
    icon: ListPlus,
    one: (e) => `${who(e.name, e.avatar)} added ${song(e)}`,
    burst: (e, n) => `${who(e.name, e.avatar)} added ${n} songs`,
  },
  [FeedKind.Removed]: {
    icon: ListMinus,
    one: (e) => `${who(e.name, e.avatar)} removed ${song(e)}`,
    burst: (e, n) => `${who(e.name, e.avatar)} removed ${n} songs`,
  },
  [FeedKind.Moved]: {
    icon: ArrowUpDown,
    one: (e) => `${who(e.name, e.avatar)} moved ${song(e)} to #${e.position}`,
    burst: (e, n) => `${who(e.name, e.avatar)} moved ${n} songs`,
  },
  // Only the host skips without votes.
  [FeedKind.Skipped]: {
    icon: SkipForward,
    one: (e) =>
      e.votes
        ? `Skipped ${song(e)} · ${e.votes} ${e.votes === 1 ? "vote" : "votes"}`
        : `Host skipped ${song(e)}`,
    burst: (_, n) => `Skipped ${n} songs`,
  },
  [FeedKind.Shuffled]: {
    icon: Shuffle,
    one: (e) => `${who(e.name, e.avatar)} shuffled Up next`,
    burst: (e, n) => `${who(e.name, e.avatar)} shuffled Up next ${n} times`,
  },
  // Only the host removes guests, each once, so a burst never happens.
  [FeedKind.Kicked]: {
    icon: UserMinus,
    one: (e) => `Host removed ${who(e.name, e.avatar)}`,
    burst: (e) => `Host removed ${who(e.name, e.avatar)}`,
  },
};

type Props = { entry: ActivityEntry; count?: number };

/** One muted line saying what happened to a song, with a small icon. */
export function ActivityText({ entry, count = 1 }: Props) {
  const { icon: Icon, one, burst } = WORDING[entry.kind];
  return (
    <>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{count > 1 ? burst(entry, count) : one(entry)}</span>
    </>
  );
}
