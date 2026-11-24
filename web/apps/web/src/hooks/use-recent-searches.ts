import { useState } from "react";

// Recent searches live in this browser only, like Saved: no account.
const RECENT_KEY = "nimbrung.recent";
const RECENT_MAX = 8;

function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((q) => typeof q === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

/** This browser's last few searches, newest first. */
export function useRecentSearches() {
  const [recent, setRecent] = useState(readRecent);
  // Remembered when the search was worth something: Enter, or a song added from it.
  function remember(q: string) {
    const text = q.trim();
    if (text.length < 2) return;
    const next = [text, ...recent.filter((r) => r.toLowerCase() !== text.toLowerCase())].slice(
      0,
      RECENT_MAX,
    );
    setRecent(next);
    writeRecent(next);
  }
  function forget() {
    setRecent([]);
    writeRecent([]);
  }
  return { recent, remember, forget };
}
