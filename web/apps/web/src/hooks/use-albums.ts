import { useQuery } from "@tanstack/react-query";

import { api, SearchKind, type Track } from "@/api/client";
import { QueryKey } from "@/hooks/query-keys";
import { useSearch } from "@/hooks/use-queue";
import { useRoomState } from "@/hooks/use-room-state";

// An album's songs don't change in a night.
const ALBUM_STALE = 30 * 60_000;
// A strip is a taste of the chip behind "See all", not the whole list.
const STRIP_VIDEOS = 8;

/** An album's cover and songs, to add from one by one. No id, no ask (a pasted link that isn't one). */
export function useAlbum(id: string | undefined) {
  return useQuery({
    queryKey: [QueryKey.Album, id],
    queryFn: () => api.album(id!),
    enabled: !!id,
    staleTime: ALBUM_STALE,
  });
}

/**
 * The albums matching what's typed, for the strip over the songs. It asks
 * what the Albums chip asks, so "See all" opens on a list already loaded.
 * Nothing while it fails: the songs below are the answer.
 */
export function useAlbumStrip(input: string, enabled: boolean) {
  const albums = useSearch(input, SearchKind.Albums, enabled);
  return enabled && !albums.isError ? (albums.data?.albums ?? []) : [];
}

/** The first few videos matching what's typed, like useAlbumStrip for the Videos chip. */
export function useVideoStrip(input: string, enabled: boolean) {
  const videos = useSearch(input, SearchKind.Videos, enabled);
  return enabled && !videos.isError ? (videos.data?.tracks ?? []).slice(0, STRIP_VIDEOS) : [];
}

/**
 * The song a pasted link points at, to show what it is before adding. Adding
 * by link works without it, so a miss only costs the title.
 */
export function useLinkedTrack(videoId: string | undefined) {
  return useQuery({
    queryKey: [QueryKey.Track, videoId],
    queryFn: () => api.track(videoId!),
    enabled: !!videoId,
    staleTime: ALBUM_STALE,
    retry: false,
  });
}

/**
 * Songs like the one playing, not in the queue yet: YouTube's song radio for
 * it. Until that answers (or if it has nothing), the player's own autoplay
 * guess stands in, so the shelf is never empty for no reason.
 */
export function useLikePlaying(limit: number): Track[] {
  const room = useRoomState();
  const np = room?.nowPlaying;
  const { data } = useQuery({
    queryKey: [QueryKey.Radio, np?.videoId],
    queryFn: () => api.radio(np!.videoId),
    enabled: !!np?.videoId,
    staleTime: ALBUM_STALE, // a song's radio barely changes in a night; the server remembers it too
    retry: false,
  });
  const taken = new Set([np?.videoId, ...(room?.queue ?? []).map((t) => t.videoId)]);
  const radio = data?.tracks.length ? data.tracks : (room?.autoplay ?? []);
  return radio.filter((t) => !taken.has(t.videoId)).slice(0, limit);
}
