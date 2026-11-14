import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  FeedKind,
  ServerEvent,
  api,
  isTooFast,
  type ActivityEntry,
  type CommentEntry,
  type Reaction,
  type ReactionSent,
  type VolumeNudge,
} from "@/api/client";
import { onServerEvent } from "@/hooks/use-room-state";
import { who } from "@/lib/who";

// How long each moment stays on screen. These match the animations in
// index.css, which end invisible, so a timer running late shows nothing.
const FLOAT_MS = 2500;
const SLIDE_MS = 7000;
const ACTIVITY_MS = 3000;

// Past these the oldest leaves early, so a busy room can't bury the screen.
const MAX_SLIDING = 4;
const MAX_FLOATING = 40;

/** Something on screen for a moment; seq counts up per kind of moment. */
export type Passing<T> = { seq: number; value: T };

/**
 * One tap's floating emoji. A streak (one guest, one emoji, each tap before
 * the last one has floated away) rises from one spot, anchor, and only its
 * first float carries the name, so spamming reads as one person's stream.
 */
export type ReactionFloat = { reaction: Reaction; anchor: number; name?: string };

/** The one line of song activity: entry is the latest of count in a row by one guest. */
export type ActivityLine = { entry: ActivityEntry; count: number };

export type LiveMoments = {
  reactions: Passing<ReactionFloat>[];
  comments: Passing<CommentEntry>[];
  activity: ActivityLine | null;
};

/** Everything on the now-playing card right now, as seen by meId. */
export function useLiveMoments(meId: string): LiveMoments {
  return {
    reactions: usePassing(onReactionFloat, FLOAT_MS, MAX_FLOATING),
    comments: usePassing(onComment, SLIDE_MS, MAX_SLIDING),
    activity: useActivityLine(meId),
  };
}

export function useReact() {
  return useMutation({
    // Over the limit a tap just doesn't fly; spamming shouldn't print errors.
    mutationFn: (reaction: Reaction) =>
      api.react(reaction).catch((err) => {
        if (!isTooFast(err)) throw err;
      }),
    meta: { inlineError: true }, // shown under the reaction bar
  });
}

export function useNudge() {
  return useMutation({
    // null takes the guest's ask back
    mutationFn: (way: VolumeNudge | null) => (way ? api.nudge(way) : api.withdrawNudge()),
    meta: { inlineError: true }, // shown next to the nudge buttons
  });
}

export function useComment() {
  return useMutation({
    mutationFn: api.comment,
    meta: { inlineError: true }, // shown under the comment box
  });
}

function onReactionFloat(show: (f: ReactionFloat) => void) {
  const streaks = new Map<string, { anchor: number; at: number }>();
  let taps = 0;
  return onServerEvent(ServerEvent.Reaction, ({ reaction, guestId, name, avatar }: ReactionSent) => {
    const key = `${guestId}:${reaction}`;
    const now = Date.now();
    const streak = streaks.get(key);
    const fresh = !streak || now - streak.at > FLOAT_MS;
    const anchor = fresh ? taps : streak.anchor;
    taps++;
    streaks.set(key, { anchor, at: now });
    show({ reaction, anchor, name: fresh ? who(name, avatar) : undefined });
  });
}

// Your own comment slides by too: seeing it go up is how you know it was sent.
function onComment(show: (c: CommentEntry) => void) {
  return onServerEvent(ServerEvent.Feed, (entry) => {
    if (entry.kind === FeedKind.Comment) show(entry);
  });
}

function usePassing<T>(listen: (show: (value: T) => void) => () => void, ms: number, max: number) {
  const [items, setItems] = useState<Passing<T>[]>([]);
  const nextSeq = useRef(0);
  useEffect(
    () =>
      listen((value) => {
        const item = { seq: nextSeq.current++, value };
        setItems((all) => [...all, item].slice(-max));
        setTimeout(() => setItems((all) => all.filter((i) => i !== item)), ms);
      }),
    [listen, ms, max],
  );
  return items;
}

/**
 * Someone else's add, remove, move or skip, one quiet line at a time. A burst
 * by the same guest becomes one line with a count ("Rina added 3 songs").
 * Your own actions don't show: you saw them where you made them, and the
 * Chat list has them.
 */
function useActivityLine(meId: string) {
  const [line, setLine] = useState<ActivityLine | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onServerEvent(ServerEvent.Feed, (entry) => {
      if (entry.kind === FeedKind.Comment || entry.guestId === meId) return;
      setLine((prev) => ({
        entry,
        count: prev && sameBurst(prev.entry, entry) ? prev.count + 1 : 1,
      }));
      clearTimeout(timer);
      timer = setTimeout(() => setLine(null), ACTIVITY_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [meId]);
  return line;
}

const sameBurst = (a: ActivityEntry, b: ActivityEntry) =>
  a.kind === b.kind && a.guestId === b.guestId;
