import { type LucideIcon, Volume1, Volume2 } from "lucide-react";

import { type Nudges, VolumeNudge } from "@/api/client";

/** How each nudge is worded; the server only knows the name. */
export const NUDGE_LOOKS: Record<VolumeNudge, { label: string; asked: string; icon: LucideIcon }> = {
  [VolumeNudge.Quieter]: { label: "Quieter", asked: "quieter", icon: Volume1 },
  [VolumeNudge.Louder]: { label: "Louder", asked: "louder", icon: Volume2 },
};

/** The way this guest last asked, if their ask is still standing. */
export const myNudge = (nudges: Nudges | null, meId: string) =>
  Object.values(VolumeNudge).find((way) => nudges?.[way]?.includes(meId));

type Props = { mine?: VolumeNudge; onNudge: (way: VolumeNudge) => void };

/**
 * Guests can't touch the volume; they ask, with Quieter | Louder in the
 * reactions row. Each guest counts once, their latest ask, and it fades
 * after a couple of minutes or when the host turns the knob.
 */
export function VolumeNudges({ mine, onNudge }: Props) {
  return (
    <div role="group" aria-label="Ask the host about the volume" className="seg-group">
      {Object.values(VolumeNudge).map((way) => (
        <button
          key={way}
          type="button"
          aria-pressed={mine === way}
          aria-label={`Ask the host for ${NUDGE_LOOKS[way].asked}`}
          title={NUDGE_LOOKS[way].label}
          onClick={() => onNudge(way)}
        >
          <Icon way={way} />
        </button>
      ))}
    </div>
  );
}

function Icon({ way }: { way: VolumeNudge }) {
  const { icon: VolumeIcon } = NUDGE_LOOKS[way];
  return <VolumeIcon className="size-[18px]" aria-hidden />;
}
