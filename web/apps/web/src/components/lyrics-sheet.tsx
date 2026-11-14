import { ChevronDown, MessageSquareQuote } from "lucide-react";
import { useRef, useState } from "react";

import type { NowPlaying } from "@/api/client";
import { LyricsLines } from "@/components/lyrics-lines";
import { useLyrics, useSongTime } from "@/hooks/use-lyrics";
import { formatDuration } from "@/lib/time";

/** The lyrics button beside the heart, and the full-screen sheet it opens. */
export function LyricsSheet({ song }: { song: NowPlaying }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Asked only once the sheet opens, so nobody looks up lyrics they never read.
  const lyrics = useLyrics(open ? song.videoId : undefined);
  const time = useSongTime(song);
  const close = () => dialog.current?.close();
  const elapsed = song.duration > 0 ? Math.min(time, song.duration) : time;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Lyrics"
        className="icon-btn text-[var(--lg-ink)]"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <MessageSquareQuote className="size-[22px]" />
      </button>
      <dialog
        ref={dialog}
        aria-label="Lyrics"
        className="sheet lyrics-sheet"
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {/* Drawn only while open: closed, it would repeat the card's title for screen readers. */}
        {open && (
          <div className="relative isolate flex h-full flex-col">
            {/* The song's own art, blurred into a backdrop, dimmed so white lines read on any cover. */}
            {song.thumb && (
              <img
                src={song.thumb}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 size-full scale-150 object-cover opacity-70 blur-[48px] saturate-150"
              />
            )}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[rgb(15_10_18/0.45)]" />

            <span aria-hidden className="mx-auto mt-2.5 h-[5px] w-10 shrink-0 rounded-full bg-white/40" />
            <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-1.5">
              <span className="size-11 shrink-0 overflow-hidden rounded-[9px] bg-white/10 shadow-[0_6px_16px_-6px_rgb(0_0_0/0.6)]">
                {song.thumb && <img src={song.thumb} alt="" className="size-full object-cover" />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold">{song.title}</h2>
                <p className="truncate text-sm font-medium t-2">{song.artist}</p>
              </div>
              <button type="button" className="chat-close" aria-label="Close lyrics" onClick={close}>
                <ChevronDown className="size-4" strokeWidth={2.6} />
              </button>
            </header>

            <div className="min-h-0 flex-1 px-5">
              <LyricsLines lyrics={lyrics.data} loading={lyrics.isPending} time={time} />
            </div>

            <footer className="grid shrink-0 gap-2 px-[22px] pt-1.5 pb-[max(20px,env(safe-area-inset-bottom))]">
              {song.duration > 0 && (
                <>
                  <div className="progress">
                    <i style={{ width: `${(elapsed / song.duration) * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-xs font-semibold tabular-nums t-2">
                    <span>{formatDuration(elapsed)}</span>
                    <span>{formatDuration(song.duration)}</span>
                  </div>
                </>
              )}
              {lyrics.data && <p className="text-center text-[11px] t-2">Lyrics from LRCLIB</p>}
            </footer>
          </div>
        )}
      </dialog>
    </>
  );
}
