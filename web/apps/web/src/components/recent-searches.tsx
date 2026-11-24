import { Clock } from "lucide-react";

type Props = { recent: string[]; onPick: (q: string) => void; onClear: () => void };

/** This phone's last few searches as chips; tapping one runs it again. */
export function RecentSearches({ recent, onPick, onClear }: Props) {
  if (recent.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading">
      <div className="flex items-center justify-between">
        <h2 id="recent-heading" className="shelf-heading">
          Recent searches
        </h2>
        <button type="button" onClick={onClear} className="min-h-9 px-1 text-[13px] t-2">
          Clear
        </button>
      </div>
      <ul className="flex flex-wrap gap-2 pt-2">
        {recent.map((q) => (
          <li key={q} className="min-w-0">
            <button type="button" onClick={() => onPick(q)} className="chip max-w-full gap-1.5">
              <Clock className="size-3.5 shrink-0 t-2" aria-hidden />
              <span className="truncate">{q}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
