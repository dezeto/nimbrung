import type { RoomInfo } from "@/api/client";

// The hosts guests paste or share links from, as in api.VideoIDFromURL.
const youtubeHosts = new Set(["youtube.com", "music.youtube.com", "m.youtube.com"]);
const SHORT_HOST = "youtu.be";
// Paths whose second part is the video, as in api.VideoIDFromURL.
const videoPaths = new Set(["shorts", "embed", "live"]);
const isVideoId = (s: string) => /^[\w-]{11}$/.test(s);
const isAlbumId = (s: string) => /^MPREb_[\w-]{5,40}$/.test(s); // as room.albumIDs

/** The link as a URL, with or without its https://, or undefined when it isn't one. */
function parse(raw: string): URL | undefined {
  const text = raw.trim();
  try {
    return new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return undefined;
  }
}

/** The host without its www., which links come both with and without. */
const hostOf = (url: URL) => url.hostname.replace(/^www\./, "");

/**
 * The song a link plays: watch?v=…, youtu.be/…, /shorts/…, /embed/…, /live/….
 * Mirrors api.VideoIDFromURL on the server, which is what adds by link.
 */
export function videoIdFromUrl(raw: string): string | undefined {
  const url = parse(raw);
  if (!url) return undefined;
  const host = hostOf(url);
  if (host === SHORT_HOST) {
    const id = url.pathname.replace(/^\/+|\/+$/g, "");
    return isVideoId(id) ? id : undefined;
  }
  if (!youtubeHosts.has(host)) return undefined;
  const v = url.searchParams.get("v");
  if (v) return isVideoId(v) ? v : undefined;
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  return parts.length === 2 && videoPaths.has(parts[0]) && isVideoId(parts[1]) ? parts[1] : undefined;
}

/**
 * The playlist a link opens, for a playlist link (…/playlist?list=PL…).
 * A song played from a playlist (watch?v=…&list=…) is still a song link, so
 * it gets undefined and is added as a song, as before.
 */
export function playlistIdFromUrl(raw: string): string | undefined {
  const url = parse(raw);
  if (!url || !youtubeHosts.has(hostOf(url)) || url.searchParams.has("v")) return undefined;
  const id = url.searchParams.get("list");
  return id && /^[\w-]+$/.test(id) ? id : undefined;
}

/** The album a YouTube Music album link opens (…/browse/MPREb_…). */
export function albumIdFromUrl(raw: string): string | undefined {
  const url = parse(raw);
  if (!url || !youtubeHosts.has(hostOf(url))) return undefined;
  const [first, id, ...rest] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  return first === "browse" && rest.length === 0 && id && isAlbumId(id) ? id : undefined;
}

/** What a link in the search box points at. */
export enum LinkKind {
  Song = "song",
  Playlist = "playlist",
  Album = "album",
  /** A YouTube link to something that isn't one of the above: a channel, the home page. */
  OtherYouTube = "other-youtube",
  /** A link, but not to YouTube. */
  Elsewhere = "elsewhere",
}

export type PastedLink =
  | { kind: LinkKind.Song; videoId: string }
  | { kind: LinkKind.Playlist; playlistId: string }
  | { kind: LinkKind.Album; albumId: string }
  | { kind: LinkKind.OtherYouTube | LinkKind.Elsewhere };

/**
 * What's in the search box, if it's a link rather than words to search:
 * one piece with a scheme, or a host with a path ("youtu.be/…"). Words with
 * a dot in them ("mr.brightside") stay a search.
 */
export function readLink(raw: string): PastedLink | undefined {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return undefined;
  if (!text.includes("://") && !/^([a-z0-9-]+\.)+[a-z]{2,}\//i.test(text)) return undefined;
  const url = parse(text);
  if (!url || !url.hostname.includes(".")) return undefined;

  const videoId = videoIdFromUrl(text);
  if (videoId) return { kind: LinkKind.Song, videoId };
  const playlistId = playlistIdFromUrl(text);
  if (playlistId) return { kind: LinkKind.Playlist, playlistId };
  const albumId = albumIdFromUrl(text);
  if (albumId) return { kind: LinkKind.Album, albumId };
  const host = hostOf(url);
  return { kind: youtubeHosts.has(host) || host === SHORT_HOST ? LinkKind.OtherYouTube : LinkKind.Elsewhere };
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
