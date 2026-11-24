import { ArrowDown, MessageSquareX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Lyrics } from "@/api/client";

type Props = {
  lyrics: Lyrics | null | undefined;
  loading: boolean;
  time: number; // seconds into the song
  big?: boolean; // the room view's size
  onSeek?: (at: number) => void; // given, a tapped line jumps the song to it (the host's)
};

/** The current line of timed lyrics (the last one already started), or -1 before the first. */
export const currentLine = (lines: { at: number }[], time: number) => lines.findLastIndex((l) => l.at <= time);

// How far down the box the current line sits: a third on a phone, lower on the TV.
const ANCHOR = { phone: 0.33, big: 0.4 };
// Room above the first line and below the last: just past the edge fades, so
// the opening lines sit at the top and the closing ones at the bottom, like a
// music app, instead of beside a blank screen. Lines near either end stop
// short of the anchor; that's fine.
const PAD = { phone: { top: "28px", bottom: "64px" }, big: { top: "48px", bottom: "96px" } };
// After someone scrolls by hand, follow the song again this long after they stop.
const RESUME_MS = 4000;

/**
 * Lyrics that follow the song in their own scroll box: sung lines fade, the
 * current one is bright and held a third of the way down, the next ones wait
 * half-bright. Scrolling by hand pauses following and offers "Now", back to the current line.
 * With onSeek, each line is a button that jumps the song to it.
 * The box fills its parent, so give the parent a height.
 */
export function LyricsLines({ lyrics, loading, time, big = false, onSeek }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pausedAt, setPausedAt] = useState(0); // when the last hand scroll happened; 0 = following
  const placedFor = useRef<Lyrics | null | undefined>(undefined); // lyrics already scrolled to once
  const lines = lyrics?.lines ?? [];
  const current = currentLine(lines, time);
  const following = pausedAt === 0;
  const [nowAbove, setNowAbove] = useState(false); // while paused: is the current line above what's in view?
  const anchor = big ? ANCHOR.big : ANCHOR.phone;

  // Keep the current line at the anchor, unless someone is reading elsewhere.
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>(`[data-line="${Math.max(current, 0)}"]`);
    if (!el || !row || !following) return;
    const top = row.offsetTop - el.clientHeight * anchor;
    // Jump straight there the first time (opened mid-song), glide after that.
    el.scrollTo({ top, behavior: placedFor.current === lyrics ? "smooth" : "instant" });
    placedFor.current = lyrics;
  }, [current, following, anchor, lyrics]); // lyrics: they arrive after the box opens

  useEffect(() => {
    if (following) return;
    const id = setTimeout(() => setPausedAt(0), RESUME_MS);
    return () => clearTimeout(id);
  }, [pausedAt, following]);

  // Which way the "Now" button points: toward the current line, from the anchor.
  const aim = () => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>(`[data-line="${Math.max(current, 0)}"]`);
    if (el && row) setNowAbove(row.offsetTop < el.scrollTop + el.clientHeight * anchor);
  };
  // The song moves on while someone reads: the arrow may need to turn.
  useEffect(() => {
    if (!following) aim();
  }, [current, following]);

  // Only real hands pause it: the box's own smooth scrolling fires scroll events too.
  const pause = () => lines.length > 0 && setPausedAt(Date.now());

  if (loading) {
    return (
      <div role="status" aria-label="Finding lyrics" className={`flex flex-col ${big ? "gap-8 pt-12" : "gap-5 pt-7"} px-1`}>
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
        onScroll={following ? undefined : aim}
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
            // The right padding leaves room for the current line's 1.06 scale.
            className={`flex flex-col pr-[6%] pl-1 font-extrabold tracking-[-0.02em] ${size}`}
            style={{
              paddingTop: big ? PAD.big.top : PAD.phone.top,
              paddingBottom: big ? PAD.big.bottom : PAD.phone.bottom,
            }}
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
                {onSeek ? (
                  <button
                    type="button"
                    className="lyric-seek"
                    aria-label={`Play from “${line.text || "instrumental"}”`}
                    onClick={() => {
                      setPausedAt(0); // follow again from the tapped line
                      onSeek(line.at);
                    }}
                  >
                    {line.text || <GapDots big={big} live={i === current} />}
                  </button>
                ) : (
                  line.text || <GapDots big={big} live={i === current} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {!following && (
        <button
          type="button"
          className="back-to-now glass-btn is-capsule glass-rim absolute bottom-3 left-1/2 h-9 -translate-x-1/2 gap-1.5 pr-3.5 pl-3 text-[13px] font-semibold"
          aria-label="Back to the current line"
          onClick={() => setPausedAt(0)}
        >
          {/* One arrow that turns to point at the current line, above or below. */}
          <ArrowDown
            aria-hidden
            className={`size-4 transition-transform duration-300 ease-[cubic-bezier(0.77,0,0.175,1)] ${nowAbove ? "rotate-180" : ""}`}
            strokeWidth={2.6}
          />
          Now
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
