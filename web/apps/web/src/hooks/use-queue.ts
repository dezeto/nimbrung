import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, type Playlist, type SearchKind, type Track } from "@/api/client";
import { SearchRowStatus } from "@/components/search-row";
import { QueryKey } from "@/hooks/query-keys";
import { useRoomState } from "@/hooks/use-room-state";
import { meQuery } from "@/hooks/use-session";

// No queue cache to update here: the server pushes the new queue over SSE.

/**
 * Search the player, debounced so typing doesn't fire a request per key.
 * Pages after the first repeat some of its rows, so each song shows once.
 */
export function useSearch(input: string, kind: SearchKind) {
  const query = useDebounced(input.trim(), 300);

  return useInfiniteQuery({
    queryKey: [QueryKey.Search, kind, query],
    queryFn: ({ pageParam }) => api.search(query, kind, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.next,
    enabled: query.length >= 2,
    placeholderData: keepPreviousData, // keep old rows while the next query loads
    staleTime: 60_000,
    select: ({ pages }) => ({
      tracks: uniqueBy(pages.flatMap((p) => p.tracks), (t: Track) => t.videoId),
      playlists: uniqueBy(pages.flatMap((p) => p.playlists ?? []), (p: Playlist) => p.id),
      correctedQuery: pages[0].correctedQuery,
    }),
  });
}

/** A value that only changes once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * Ways to finish what's typed so far. Quicker than the search itself: a
 * suggestion is only worth having before the guest has typed the rest.
 */
export function useSuggestions(input: string) {
  const query = useDebounced(input.trim(), 150);
  const { data } = useQuery({
    queryKey: [QueryKey.Suggest, query],
    queryFn: () => api.suggest(query),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false, // a nicety: when it fails, there are just no suggestions
  });
  // Suggesting what's already in the box is no suggestion.
  return (data ?? []).filter((s) => s.toLowerCase() !== input.trim().toLowerCase());
}

/** The songs the jam has already heard tonight, by videoId, to mark them in lists. */
export function usePlayedTonight() {
  const { data } = useQuery({
    queryKey: [QueryKey.Recap],
    queryFn: api.recap,
    staleTime: 60_000,
  });
  return new Set(data?.played?.map((p) => p.videoId));
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(key(item))) return false;
    seen.add(key(item));
    return true;
  });
}

/** A playlist's songs, to add from one by one. */
export function usePlaylist(id: string) {
  return useQuery({
    queryKey: [QueryKey.Playlist, id],
    queryFn: () => api.playlist(id),
    staleTime: 5 * 60_000,
  });
}

/**
 * Adding songs from a list of rows (search results, a playlist): the add,
 * and each row's status. The add's own variables say which row it was for.
 */
export function useRowAdds() {
  const room = useRoomState();
  const add = useAddSong();
  const playingId = room?.nowPlaying?.videoId;
  const queued = new Set(room?.queue?.map((q) => q.videoId));
  const last = add.variables;

  function statusOf(videoId: string): SearchRowStatus {
    if (videoId === playingId) return SearchRowStatus.Playing;
    if (queued.has(videoId)) return SearchRowStatus.Queued;
    if (!last || !("videoId" in last) || last.videoId !== videoId) return SearchRowStatus.Add;
    if (add.isPending) return SearchRowStatus.Adding;
    return add.isError ? SearchRowStatus.Failed : SearchRowStatus.Add;
  }
  return { add, statusOf };
}

export function useAddSong() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.addSong,
    meta: { inlineError: true }, // shown on the row or link box that failed
    onSuccess: ({ addsRemaining }) =>
      queryClient.setQueryData(meQuery.queryKey, (me) => me && { ...me, addsRemaining }),
  });
}

/** For the PWA share target: queue whatever link was shared, then report. */
export async function addSharedLink(url: string | undefined) {
  if (!url) {
    toast.error("That share didn't include a link");
    return;
  }
  try {
    await api.addSong({ url });
    toast.success("Added to the queue");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Couldn't add that link");
  }
}

export function useRemoveSong() {
  return useMutation({ mutationFn: api.removeSong });
}

export function useShuffle() {
  return useMutation({ mutationFn: api.shuffle });
}

export function useMoveSong() {
  return useMutation({ mutationFn: api.moveSong });
}

/**
 * Vote to skip the current song (the host's vote skips at once). The server
 * dedupes votes per guest, so `voted` only drives the button label; it
 * resets when the song changes. The song voted on is kept in this browser
 * so a reload still shows "voted".
 */
const SKIP_VOTE_KEY = "nimbrung.skipVote";

export function useVoteSkip(currentVideoId: string | undefined, votesSoFar: number) {
  const [votedFor, setVotedFor] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(SKIP_VOTE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const mutation = useMutation({
    mutationFn: (_videoId: string) => api.voteSkip(),
    onSuccess: (_, videoId) => {
      setVotedFor(videoId);
      try {
        localStorage.setItem(SKIP_VOTE_KEY, videoId);
      } catch {}
    },
  });
  // votesSoFar 0 means the server forgot (restart, or the song came back later).
  return { ...mutation, voted: !!currentVideoId && votedFor === currentVideoId && votesSoFar > 0 };
}
