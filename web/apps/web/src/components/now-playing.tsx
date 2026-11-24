import { Link } from "@tanstack/react-router";
import { Pause } from "lucide-react";

import type { NowPlaying } from "@/api/client";
import { AutoplayMark } from "@/components/autoplay-mark";
import { LyricsSheet } from "@/components/lyrics-sheet";
import { SaveButton } from "@/components/save-button";
import { formatDuration } from "@/lib/time";
import { who } from "@/lib/who";

// The heart shows only when onSave is given: guests get it, the host screen doesn't.
type Props = {
  song: NowPlaying | null;
  saved?: boolean;
  onSave?: (song: NowPlaying) => void;
};

export function NowPlayingCard({ song, saved = false, onSave }: Props) {
  if (!song) {
    return (
      <section
        aria-label="Now playing"
        className="glass-card glass-rim px-4 py-8 text-center text-sm t-2"
      >
        Nothing playing right now
      </section>
    );
  }
  // The plugin can report elapsed past the end (seen: 253s of a 204s song).
  const elapsed = song.duration > 0 ? Math.min(song.elapsed, song.duration) : song.elapsed;
  const progress = song.duration > 0 ? (elapsed / song.duration) * 100 : 0;

  // Like a music app's Now Playing: the artwork big and centred, no card
  // around it (the page's backdrop is already this song's colours). Capped by
  // height too, so on a phone Up next still peeks above the Add a song bar.
  return (
    <section aria-label="Now playing" className="flex flex-col gap-4 pt-1">
      <div className="relative mx-auto aspect-square w-[min(78vw,320px,32svh)] overflow-hidden rounded-[22px] bg-muted shadow-[0_28px_60px_-20px_rgb(0_0_0/0.75)]">
        {song.thumb && (
          <img src={song.thumb} alt="" fetchPriority="high" className="size-full object-cover" />
        )}
        {song.isPaused && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
            <Pause className="size-10" />
            <span className="sr-only">Paused</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 px-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="line-clamp-2 text-[24px] leading-[30px] font-bold tracking-[-0.02em]">
            {song.title}
          </h2>
          {/* The artist opens their page; one the queue can't name by ID opens a search for them. */}
          <p className="-my-1.5 truncate py-1.5 text-[17px] leading-6 font-medium t-2">
            {song.artistId ? (
              <Link to="/artist/$artistId" params={{ artistId: song.artistId }} className="row-artist">
                {song.artist}
              </Link>
            ) : song.artist ? (
              <Link to="/search" search={{ q: song.artist }} className="row-artist">
                {song.artist}
              </Link>
            ) : null}
          </p>
          <p className="truncate pt-0.5 text-[13px] t-2">
            {song.addedBy ? `Added by ${who(song.addedBy, song.addedByAvatar)}` : <AutoplayMark labelled />}
          </p>
        </div>
        <LyricsSheet song={song} />
        {onSave && <SaveButton title={song.title} saved={saved} onToggle={() => onSave(song)} />}
      </div>

      {song.duration > 0 && (
        <div className="grid gap-1.5 px-1">
          <div
            className="progress"
            role="progressbar"
            aria-label="Song progress"
            aria-valuemin={0}
            aria-valuemax={song.duration}
            aria-valuenow={Math.round(elapsed)}
          >
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-xs font-semibold tabular-nums t-2">
            <span>{formatDuration(elapsed)}</span>
            <span>{formatDuration(song.duration)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
