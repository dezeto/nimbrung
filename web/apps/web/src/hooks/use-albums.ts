import { useQuery } from "@tanstack/react-query";

import { api, SearchKind } from "@/api/client";
import { QueryKey } from "@/hooks/query-keys";
import { useSearch } from "@/hooks/use-queue";

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
