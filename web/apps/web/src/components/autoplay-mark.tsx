import { Infinity as InfinityIcon } from "lucide-react";

/**
 * Marks a song the player queued by itself, with YouTube Music's ∞ autoplay
 * sign; `labelled` spells it out where there's room.
 */
export function AutoplayMark({ labelled = false }: { labelled?: boolean }) {
  if (labelled) {
    return (
      <span className="inline-flex items-center gap-1 align-middle">
        <InfinityIcon className="size-3.5" aria-hidden /> Autoplay
      </span>
    );
  }
  return (
    <span role="img" aria-label="Autoplay" title="Autoplay" className="inline-flex align-middle">
      <InfinityIcon className="size-3.5" aria-hidden />
    </span>
  );
}
