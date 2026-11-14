import { useEffect, useState } from "react";

import { useRoomState } from "@/hooks/use-room-state";
import { loadAccent } from "@/lib/accent";

/**
 * The current song's artwork behind every page, blurred and dimmed (styles in
 * glass.css). The last song's art stays underneath while the new one fades in
 * over it, so a song change crossfades instead of flashing the ground.
 */
export function AmbientBackdrop() {
  const thumb = useRoomState()?.nowPlaying?.thumb;
  const [layers, setLayers] = useState<string[]>([]);

  useEffect(() => {
    if (thumb) setLayers((prev) => (prev.at(-1) === thumb ? prev : [...prev.slice(-1), thumb]));
  }, [thumb]);

  // The song's own colour for progress bars (--np-accent); the red when there's none.
  useEffect(() => {
    let current = true;
    const root = document.documentElement.style;
    if (!thumb) {
      root.removeProperty("--np-accent");
      return;
    }
    void loadAccent(thumb).then((accent) => {
      if (!current) return;
      if (accent) root.setProperty("--np-accent", accent);
      else root.removeProperty("--np-accent");
    });
    return () => {
      current = false;
    };
  }, [thumb]);

  return (
    <div className="ambient" aria-hidden>
      {thumb && layers.map((src) => <img key={src} src={src} alt="" />)}
    </div>
  );
}
