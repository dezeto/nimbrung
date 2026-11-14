import { useSyncExternalStore } from "react";

import {
  ServerEvent,
  eventsUrl,
  type FeedEntry,
  type ReactionSent,
  type RoomState,
} from "@/api/client";

// One EventSource shared by every component: opened by the first subscriber,
// closed when the last one unmounts. EventSource reconnects on its own, and
// the server sends a full snapshot on connect, so there is nothing to resync.
let state: RoomState | null = null;
let source: EventSource | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!source) {
    source = new EventSource(eventsUrl);
    source.addEventListener(ServerEvent.State, (e) => {
      state = JSON.parse(e.data);
      listeners.forEach((l) => l());
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}

/** Live room snapshot pushed over SSE; null until the first event lands. */
export function useRoomState() {
  return useSyncExternalStore(subscribe, () => state);
}

/** What each SSE event that is a moment, not a snapshot, carries. */
type Moments = { [ServerEvent.Reaction]: ReactionSent; [ServerEvent.Feed]: FeedEntry };

/**
 * Calls handle with each reaction or feed entry as it arrives, until the
 * returned function is called. Nothing keeps them: a moment missed is gone,
 * and the feed's history comes with the snapshot instead.
 */
export function onServerEvent<E extends keyof Moments>(
  event: E,
  handle: (data: Moments[E]) => void,
) {
  const release = subscribe(() => {}); // holds the shared EventSource open
  const listener = (e: MessageEvent<string>) => handle(JSON.parse(e.data));
  source?.addEventListener(event, listener);
  return () => {
    source?.removeEventListener(event, listener);
    release();
  };
}
