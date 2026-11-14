import { Button } from "@web/ui/components/button";

import type { Blocked } from "@/api/client";

type Props = {
  blocked: Blocked[];
  unblockingId?: string;
  error?: string;
  onUnblock: (blockedId: string) => void;
};

/** Networks the host blocked; unblocking lets anyone there join again. */
export function BlockedList({ blocked, unblockingId, error, onUnblock }: Props) {
  if (blocked.length === 0) return null;
  return (
    <div className="grid gap-1 border-t border-border pt-2">
      <h3 className="text-xs text-muted-foreground">Blocked · {blocked.length}</h3>
      <ul>
        {blocked.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 py-1 text-sm">
            <span className="truncate text-muted-foreground">{b.name}’s network</span>
            <Button
              size="sm"
              variant="ghost"
              className="-my-1 shrink-0"
              disabled={unblockingId === b.id}
              onClick={() => onUnblock(b.id)}
              aria-label={`Unblock ${b.name}’s network`}
            >
              {unblockingId === b.id ? "Unblocking…" : "Unblock"}
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="first-letter:uppercase text-xs text-primary">
          {error}
        </p>
      )}
    </div>
  );
}
