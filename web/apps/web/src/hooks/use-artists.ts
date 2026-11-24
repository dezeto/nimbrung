import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { QueryKey } from "@/hooks/query-keys";
import { useDebounced } from "@/hooks/use-queue";
import { useRoomState } from "@/hooks/use-room-state";

// An artist's songs barely change in a night, and the server remembers them too.
const ARTIST_STALE = 30 * 60_000;

const artistQuery = (id: string) => ({
  queryKey: [QueryKey.Artist, id],
  queryFn: () => api.artist(id),
  staleTime: ARTIST_STALE,
});

/** An artist's photo and songs, to add from one by one. */
export function useArtist(id: string) {
  return useQuery(artistQuery(id));
}

/** The artists matching what's typed, debounced like the song search beside it. */
export function useArtistSearch(input: string, enabled: boolean) {
  const query = useDebounced(input.trim(), 300);
  const { data } = useQuery({
    queryKey: [QueryKey.ArtistSearch, query],
    queryFn: () => api.artists(query),
    enabled: enabled && query.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false, // the songs below are the answer; artists are a shortcut
  });
  return enabled && query.length >= 2 ? (data ?? []) : [];
}

/** An artist on a shelf: the name and photo are missing until YouTube answers. */
export type ShelfArtist = { id: string; name?: string; thumb?: string };

// As many as a guest will swipe through.
const JAM_ARTISTS = 8;

/**
 * The artists of now playing and the queue, in play order, each once. The
 * queue only knows a song's first artist by ID, so names and photos are asked
 * for one by one; an artist YouTube can't open is left out.
 */
export function useJamArtists(): ShelfArtist[] {
  const room = useRoomState();
  const songs = [room?.nowPlaying, ...(room?.queue ?? [])];
  const ids = [...new Set(songs.flatMap((song) => (song?.artistId ? [song.artistId] : [])))].slice(
    0,
    JAM_ARTISTS,
  );
  const pages = useQueries({ queries: ids.map((id) => ({ ...artistQuery(id), retry: false })) });
  return ids.flatMap((id, i) => {
    const page = pages[i];
    return page.isError ? [] : [{ id, name: page.data?.name, thumb: page.data?.thumb }];
  });
}
