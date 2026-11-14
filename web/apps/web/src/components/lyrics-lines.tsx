import { ArrowDown, MessageSquareX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Lyrics } from "@/api/client";

type Props = {
  lyrics: Lyrics | null | undefined;
  loading: boolean;
  time: number; // seconds into the song
  big?: boolean; // the room view's size
};

/** The current line of timed lyrics (the last one already started), or -1 before the first. */
export const currentLine = (lines: { at: number }[], time: number) => lines.findLastIndex((l) => l.at <= time);

// How far down the box the current line sits: a third on a phone, lower on the TV.
const ANCHOR = { phone: 0.33, big: 0.4 };
// Room above the first line and below the last, so both can reach the anchor.
const PAD = { phone: "28svh", big: "32svh" };
// After someone scrolls by hand, follow the song again this long after they stop.
const RESUME_MS = 4000;

/**
 * Lyrics that follow the song in their own scroll box: sung lines fade, the
 * current one is bright and held a third of the way down, the next ones wait
 * half-bright. Scrolling by hand pauses following and offers "Back to now".
 * The box fills its parent, so give the parent a height.
 */
export function LyricsLines({ lyrics, loading, time, big = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pausedAt, setPausedAt] = useState(0); // when the last hand scroll happened; 0 = following
  const lines = lyrics?.lines ?? [];
  const current = currentLine(lines, time);
  const following = pausedAt === 0;

  // Keep the current line at the anchor, unless someone is reading elsewhere.
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>(`[data-line="${Math.max(current, 0)}"]`);
    if (!el || !row || !following) return;
    const top = row.offsetTop - el.clientHeight * (big ? ANCHOR.big : ANCHOR.phone);
    el.scrollTo({ top, behavior: "smooth" });
  }, [current, following, big]);

  useEffect(() => {
    if (following) return;
    const id = setTimeout(() => setPausedAt(0), RESUME_MS);
    return () => clearTimeout(id);
  }, [pausedAt, following]);

  // Only real hands pause it: the box's own smooth scrolling fires scroll events too.
  const pause = () => lines.length > 0 && setPausedAt(Date.now());

  if (loading) {
    return (
      <div role="status" aria-label="Finding lyrics" className={`flex flex-col ${big ? "gap-8 pt-[20svh]" : "gap-5 pt-[18svh]"} px-1`}>
        {[82, 64, 74, 52, 68].map((w, i) => (
          <span
            key={w}
            className={`${big ? "h-12" : "h-7"} animate-pulse rounded-[10px]`}
            style={{ width: `${w}%`, background: `rgb(var(--nb-fg) / ${0.16 - i * 0.025})` }}
          />
        ))}
      </div>
    );
  }
  if (!lyrics) {
    return (
      <div className="grid h-full place-content-center justify-items-center gap-3 px-8 text-center">
        <span className={`grid place-items-center rounded-full bg-[rgb(var(--nb-fg)/0.12)] ${big ? "size-24" : "size-16"}`}>
          <MessageSquareX className={big ? "size-10 t-2" : "size-7 t-2"} />
        </span>
        <p className={`font-bold ${big ? "text-[34px]" : "text-xl"}`}>No lyrics for this song</p>
        <p className={`t-2 ${big ? "text-xl" : "text-[15px] leading-[21px]"}`}>
          Covers and remixes often don’t have any yet. Sing it your way.
        </p>
      </div>
    );
  }

  const size = big ? "text-[50px] leading-[58px] gap-[26px]" : "text-[30px] leading-9 gap-5";
  return (
    <div className="relative h-full">
      <div
        ref={box}
        onWheel={pause}
        onTouchMove={pause}
        onKeyDown={pause}
        // Focusable so a keyboard can scroll it; the fade hides the edges.
        tabIndex={0}
        aria-label="Lyrics"
        className="lyrics-fade h-full overflow-x-hidden overflow-y-auto overscroll-contain outline-none [scrollbar-width:none]"
      >
        {lines.length === 0 ? (
          <p className={`whitespace-pre-line px-1 py-[20%] font-bold ${big ? "text-[36px] leading-[46px]" : "text-[22px] leading-8"}`}>
            {lyrics.plain}
          </p>
        ) : (
          <ol
            className={`flex flex-col px-1 font-extrabold tracking-[-0.02em] ${size}`}
            style={{ paddingBlock: big ? PAD.big : PAD.phone }}
          >
            {lines.map((line, i) => (
              <li
                key={`${line.at}-${i}`}
                data-line={i}
                aria-current={i === current ? "true" : undefined}
                className={`origin-left transition-[color,transform] duration-500 ${
                  i === current
                    ? "lyric-now scale-[1.06]"
                    : i < current
                      ? "lyric-sung"
                      : "lyric-next"
                }`}
              >
                {line.text || <GapDots big={big} live={i === current} />}
              </li>
            ))}
          </ol>
        )}
      </div>
      {!following && (
        <button
          type="button"
          className="glass-btn is-capsule glass-rim absolute bottom-3 left-1/2 h-10 -translate-x-1/2 gap-2 pr-4 pl-3 text-sm font-semibold"
          onClick={() => setPausedAt(0)}
        >
          <ArrowDown className="size-4" strokeWidth={2.6} /> Back to now
        </button>
      )}
    </div>
  );
}

/** An instrumental gap: three dots that breathe while it's the current line. */
function GapDots({ big, live }: { big: boolean; live: boolean }) {
  return (
    <span role="img" aria-label="Instrumental" className={`flex py-2 ${big ? "gap-3.5" : "gap-2.5"}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`${big ? "size-[18px]" : "size-3"} rounded-full bg-current ${live ? "lyrics-dot" : ""}`}
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}
