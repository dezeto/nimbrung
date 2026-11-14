import type { RoomInfo } from "@/api/client";

// The hosts guests paste or share links from, as in api.VideoIDFromURL.
const youtubeHosts = new Set(["youtube.com", "music.youtube.com", "m.youtube.com"]);

/**
 * The playlist a link opens, for a playlist link (…/playlist?list=PL…).
 * A song played from a playlist (watch?v=…&list=…) is still a song link, so
 * it gets undefined and is added as a song, as before.
 */
export function playlistIdFromUrl(raw: string): string | undefined {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (!youtubeHosts.has(url.hostname.replace(/^www\./, "")) || url.searchParams.has("v")) {
    return undefined;
  }
  const id = url.searchParams.get("list");
  return id && /^[\w-]+$/.test(id) ? id : undefined;
}

// Phones can't open "localhost", so when the host is on this machine, swap in
// the LAN address the server sees. Keeps this page's port, so it also works
// against the Vite dev server.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** The join link to share, or "" where the server doesn't tell this browser the code. */
export function inviteUrl(info: RoomInfo) {
  // On the laptop itself, use the address the server hands out: the public
  // one when -public-url is set, else the Wi-Fi one.
  if (LOOPBACK_HOSTS.has(window.location.hostname)) return info.joinUrl;
  if (!info.code) return "";
  return new URL(`/join/${info.code}`, window.location.origin).toString();
}
