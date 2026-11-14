import { useMemo, useSyncExternalStore } from "react";

import type { Track } from "@/api/client";

// Saved songs live in this browser only, like the host key: no account, and
// the list is still there at the next jam. Storage is per address, so the
// Wi-Fi link and a tunnel link each keep their own list. Storage can throw
// (private mode); then nothing sticks, and nothing breaks.
const STORAGE_KEY = "nimbrung.saved";
const listeners = new Set<() => void>();

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): Track[] {
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(tracks: Track[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
  } catch {}
  for (const notify of listeners) notify();
}

// "storage" fires when another tab changes the list.
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** This browser's saved songs, newest first, and the heart that saves or unsaves one. */
export function useSaved() {
  const raw = useSyncExternalStore(subscribe, readRaw);
  const saved = useMemo(() => parse(raw), [raw]);

  // Only the Track fields: a now-playing song also carries elapsed time and who added it.
  function toggle({ videoId, title, artist, album, thumb, duration }: Track) {
    const current = parse(readRaw());
    write(
      current.some((t) => t.videoId === videoId)
        ? current.filter((t) => t.videoId !== videoId)
        : [{ videoId, title, artist, album, thumb, duration }, ...current],
    );
  }

  return { saved, isSaved: (videoId: string) => saved.some((t) => t.videoId === videoId), toggle };
}
