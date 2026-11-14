import { Slider } from "@web/ui/components/slider";
import { Volume2, VolumeX } from "lucide-react";
import { useState } from "react";

import { type Nudges, type Volume, VolumeNudge } from "@/api/client";
import { NUDGE_LOOKS } from "@/components/volume-nudges";
import { Shortcut, ariaShortcut } from "@/hooks/use-shortcuts";

type Props = {
  volume: Volume;
  nudges: Nudges | null;
  onSetLevel: (level: number, failed: () => void) => void;
  onToggleMute: () => void;
  error?: string;
};

// "2 want it louder · 1 wants it quieter"
function nudgeLine(nudges: Nudges | null) {
  return Object.values(VolumeNudge)
    .map((way) => [way, nudges?.[way]?.length ?? 0] as const)
    .filter(([, n]) => n > 0)
    .map(([way, n]) => `${n} ${n === 1 ? "wants" : "want"} it ${NUDGE_LOOKS[way].asked}`)
    .join(" · ");
}

/**
 * The host's volume: mute plus a slider that sends one level when let go,
 * not one per pixel dragged. Guests' nudges show quietly underneath.
 */
export function VolumeControl({ volume, nudges, onSetLevel, onToggleMute, error }: Props) {
  // The level the host picked, held until the player reports it, so the
  // thumb never jumps back while the room's next snapshot is on its way.
  const [held, setHeld] = useState<number>();
  if (held !== undefined && held === volume.level) setHeld(undefined);
  const shown = held ?? volume.level;
  const asked = nudgeLine(nudges);

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="icon-btn size-10 text-[var(--lg-ink)]"
          onClick={onToggleMute}
          aria-pressed={volume.muted}
          aria-label={volume.muted ? "Unmute" : "Mute"}
          aria-keyshortcuts={ariaShortcut(Shortcut.Mute)}
        >
          {volume.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
        <Slider
          aria-label="Volume"
          min={0}
          max={100}
          value={shown}
          onValueChange={setHeld}
          onValueCommitted={(level) => onSetLevel(level, () => setHeld(undefined))}
          className={volume.muted ? "flex-1 opacity-50" : "flex-1"}
        />
        <span className="w-9 text-right text-xs tabular-nums t-2">{shown}%</span>
      </div>
      <p role="status" className="text-xs t-mine empty:hidden">
        {asked}
      </p>
      {error && (
        <p role="alert" className="first-letter:uppercase text-xs t-mine">
          {error}
        </p>
      )}
    </div>
  );
}
