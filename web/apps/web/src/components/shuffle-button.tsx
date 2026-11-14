import { Shuffle } from "lucide-react";

import { useShuffle } from "@/hooks/use-queue";

/** Round icon button that mixes up Up next once; anyone in the jam may, and the chat says who. */
export function ShuffleButton({ className = "" }: { className?: string }) {
  const shuffle = useShuffle();
  return (
    <button
      type="button"
      aria-label="Shuffle Up next"
      title="Shuffle Up next"
      className={`btn-plain p-0 ${shuffle.isPending ? "is-busy" : ""} ${className}`}
      disabled={shuffle.isPending}
      onClick={() => shuffle.mutate()}
    >
      <Shuffle className="size-4" />
    </button>
  );
}
