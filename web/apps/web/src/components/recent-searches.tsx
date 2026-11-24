import { History, X } from "lucide-react";

type Props = { recent: string[]; onPick: (q: string) => void; onClear: () => void };

/** This phone's last few searches as one row of pills under the box; tapping one runs it again. */
export function RecentSearches({ recent, onPick, onClear }: Props) {
  if (recent.length === 0) return null;
  return (
    <ul aria-label="Recent searches" className="chips -mx-4 overflow-x-auto px-4 min-[28rem]:mx-0 min-[28rem]:px-0">
      {recent.map((q) => (
        <li key={q} className="flex-none">
          <button type="button" onClick={() => onPick(q)} className="chip gap-1.5">
            <History className="size-3.5 shrink-0 t-2" aria-hidden />
            {q}
          </button>
        </li>
      ))}
      <li className="flex-none">
        <button
          type="button"
          onClick={onClear}
          className="grid size-9 place-items-center rounded-full t-2 hover:text-[var(--lg-ink)]"
          aria-label="Clear recent searches"
          title="Clear recent searches"
        >
          <X className="size-4" aria-hidden />
        </button>
      </li>
    </ul>
  );
}
