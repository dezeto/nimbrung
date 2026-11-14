import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, type NowPlaying } from "@/api/client";

/** The song's lyrics; data is null when there are none. Asked once per song. */
export function useLyrics(videoId: string | undefined) {
  return useQuery({
    queryKey: ["lyrics", videoId],
    queryFn: () => api.lyrics(videoId!),
    enabled: !!videoId,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1, // the server already retried a busy lyrics service once
  });
}

/**
 * Where the song is, in seconds, between the server's once-a-second updates:
 * counts on from the last elapsed it heard so lyric lines change on time.
 */
export function useSongTime(song: NowPlaying | null) {
  const [now, setNow] = useState(() => performance.now());
  const [heard, setHeard] = useState({ elapsed: song?.elapsed ?? 0, at: performance.now() });
  if (song && song.elapsed !== heard.elapsed) setHeard({ elapsed: song.elapsed, at: performance.now() });

  const playing = !!song && !song.isPaused;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, [playing]);

  if (!song) return 0;
  // Never run more than a second past what the server said: a stalled update shouldn't race ahead.
  const ahead = playing ? Math.min(Math.max(now - heard.at, 0) / 1000, 1) : 0;
  return heard.elapsed + ahead;
}
