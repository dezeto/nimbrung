import type { ReactNode } from "react";

import { AddsLeft } from "@/components/adds-left";

/** The glass capsule a sub-page's back control wears, as on Search and Saved. */
export const backClass = "glass-btn is-capsule glass-rim h-11 gap-1 pr-4 pl-2.5";

/**
 * The top of a page opened from Search (a playlist, an artist): back, adds
 * left, and the page's own title underneath.
 */
export function PageHeader({ back, children }: { back: ReactNode; children: ReactNode }) {
  return (
    <header className="edge-top sticky top-0 z-10 grid gap-3 px-4 pt-2 pb-3">
      <div className="flex h-[52px] items-center justify-between gap-3">
        {back}
        <AddsLeft />
      </div>
      {children}
    </header>
  );
}
