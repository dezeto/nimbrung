import type { QueueItem } from "@/api/client";

/**
 * Splits the player's queue into what guests picked and YouTube's radio.
 * Guests' songs go in ahead of the radio (room.moveBehindGuestSongs), so Up
 * next is everything up to the last song someone added; the rest is
 * autoplay, often dozens of rows. Up next keeps the queue's own positions,
 * so moves stay valid against the server's Up Next slots.
 */
export function splitQueue(queue: QueueItem[]) {
  const lastAdded = queue.findLastIndex((item) => item.addedById);
  return { upNext: queue.slice(0, lastAdded + 1), autoplay: queue.slice(lastAdded + 1) };
}

/** Total seconds of a list of songs (0 for unknown lengths). */
export const totalSeconds = (items: { duration: number }[]) =>
  items.reduce((sum, item) => sum + item.duration, 0);

/** 200 → "about 3 min"; never "0 min". */
export const aboutMinutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;
