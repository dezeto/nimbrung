import type { NowPlaying } from "@/api/client";
import { LyricsLines } from "@/components/lyrics-lines";
import { useLyrics, useSongTime } from "@/hooks/use-lyrics";

/**
 * The song's lyrics in the page, where Up next was, filling what's left above
 * the dock (the screen stops scrolling meanwhile). Drawn only while shown, so
 * nobody looks up lyrics they never read.
 */
export function LyricsPanel({ song, onSeek }: { song: NowPlaying; onSeek?: (at: number) => void }) {
  const lyrics = useLyrics(song.videoId);
  const time = useSongTime(song);
  return (
    <section aria-label="Lyrics" className="swap-in flex min-h-60 flex-1 flex-col gap-1 px-4 pb-28">
      <div className="min-h-0 flex-1">
        <LyricsLines lyrics={lyrics.data} loading={lyrics.isPending} time={time} onSeek={onSeek} />
      </div>
      {lyrics.data && <p className="text-center text-[11px] t-2">Lyrics from LRCLIB</p>}
    </section>
  );
}
