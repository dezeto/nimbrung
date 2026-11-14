import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ChevronUp } from "lucide-react";

import type { NowPlaying } from "@/api/client";
import { useRoomState } from "@/hooks/use-room-state";

/**
 * The round art with how far the song is drawn as a ring around it, so the
 * bar takes no room from the title.
 */
function ArtRing({ np }: { np: NowPlaying }) {
  const pct = np.duration > 0 ? Math.min(np.elapsed / np.duration, 1) * 100 : 0;
  return (
    <span className="relative size-11 shrink-0">
      <span className="block size-full overflow-hidden rounded-full bg-[rgb(var(--nb-fg)/0.1)]">
        {np.thumb && <img src={np.thumb} alt="" className="size-full object-cover" />}
      </span>
      {np.duration > 0 && (
        <svg aria-hidden viewBox="0 0 52 52" className="pointer-events-none absolute -inset-1 -rotate-90">
          <circle cx="26" cy="26" r="24.5" fill="none" strokeWidth="2.5" className="stroke-[rgb(var(--nb-fg)/0.16)]" />
          <circle
            cx="26"
            cy="26"
            r="24.5"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100"
            strokeDashoffset={100 - pct}
            className="stroke-[var(--np-accent,var(--nb-accent))] transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
      )}
    </span>
  );
}

/**
 * The song playing in the room, floating at the bottom of the add-a-song
 * screens like a music app's mini player. Tapping it goes back to the queue.
 */
export function MiniPlayer() {
  const np = useRoomState()?.nowPlaying;
  if (!np) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
      <Link
        to="/"
        aria-label={`Now playing: ${np.title} by ${np.artist}. Back to the queue`}
        className="glass-toolbar is-floating glass-rim pointer-events-auto flex h-[60px] items-center gap-3 pr-4 pl-2.5"
      >
        <ArtRing np={np} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] leading-[18px] font-semibold">{np.title}</p>
          <p className="truncate text-[12px] leading-4 t-2">{np.artist}</p>
        </div>
        <ChevronUp className="size-5 shrink-0 t-2" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * The Queue's sticky mini player: fades in above the bottom dock once the big
 * now-playing card has scrolled away. Tapping it scrolls back up; `action` is
 * the vote-to-skip pill, kept outside the tap target.
 */
export function StickyMiniPlayer({
  shown,
  onTap,
  action,
}: {
  shown: boolean;
  onTap: () => void;
  action: ReactNode;
}) {
  const np = useRoomState()?.nowPlaying;
  if (!np) return null;
  return (
    <div
      className="sticky-mini pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-md px-4"
      data-shown={shown}
      aria-hidden={!shown}
      inert={!shown}
    >
      <div className="glass-toolbar is-floating glass-rim pointer-events-auto flex h-[60px] items-center gap-1 pr-2 pl-2.5">
        <button type="button" onClick={onTap} aria-label={`Now playing: ${np.title} by ${np.artist}. Back to the top`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ArtRing np={np} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] leading-[18px] font-semibold">{np.title}</span>
            <span className="block truncate text-[12px] leading-4 t-2">{np.artist}</span>
          </span>
        </button>
        {action}
      </div>
    </div>
  );
}
