import { Button } from "@web/ui/components/button";
import { Crown, UserMinus } from "lucide-react";
import { useState } from "react";

import type { Guest } from "@/api/client";
import type { Kick } from "@/hooks/use-host";
import { Shortcut } from "@/hooks/use-shortcuts";
import { who } from "@/lib/who";

type Props = {
  guests: Guest[];
  meId: string;
  kicking?: Kick;
  failed?: { guestId: string; error: string }; // the last removal, if it didn't go through
  onKick: (kick: Kick) => void;
  // Set for the people waiting to join: each row gets "Let in", and removing
  // reads as turning them away.
  waitlist?: { lettingInId?: string; onLetIn: (guestId: string) => void };
};

// What removing someone is called: from the jam, or from the waitlist.
const REMOVE = {
  label: "Remove",
  pending: "Removing…",
  named: (name: string) => `Remove ${name}`,
};
const TURN_AWAY = {
  label: "Turn away",
  pending: "Turning away…",
  named: (name: string) => `Turn ${name} away`,
};

/**
 * Who's in the jam, for the host. Every row but this device's can be removed
 * (the server refuses removing yourself; the host's other devices can go like
 * anyone), after asking again on the same row: packages/ui has no dialog.
 */
export function GuestList({ guests, meId, kicking, failed, onKick, waitlist }: Props) {
  const [confirming, setConfirming] = useState<string>();
  const [kept, setKept] = useState<string>(); // its remove button gets focus back
  const remove = waitlist ? TURN_AWAY : REMOVE;

  function keep(guestId: string) {
    setConfirming(undefined);
    setKept(guestId);
  }

  return (
    <ul className="divide-y divide-border">
      {guests.map((g) => (
        <li key={g.id} className="py-2 text-sm">
          {confirming === g.id ? (
            <div
              className="flex items-center justify-between gap-3"
              onKeyDown={(e) => e.key === Shortcut.Back && keep(g.id)}
            >
              <span className="truncate">{remove.named(g.name)}?</span>
              <span className="-my-1 flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={kicking?.guestId === g.id}
                  onClick={() => onKick({ guestId: g.id, block: false })}
                >
                  {kicking?.guestId === g.id && !kicking.block ? remove.pending : remove.label}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={kicking?.guestId === g.id}
                  onClick={() => onKick({ guestId: g.id, block: true })}
                  title="Remove and stop anyone on their network joining again"
                  aria-label={`Block ${g.name}’s network`}
                >
                  {kicking?.guestId === g.id && kicking.block ? "Blocking…" : "Block"}
                </Button>
                <Button size="sm" variant="ghost" autoFocus onClick={() => keep(g.id)}>
                  Keep
                </Button>
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{who(g.name, g.avatar)}</span>
                {g.isHost && (
                  <>
                    <Crown className="size-3.5 shrink-0 text-primary" />
                    <span className="sr-only">(host)</span>
                  </>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {waitlist ? (
                  <Button
                    size="sm"
                    className="-my-1"
                    disabled={waitlist.lettingInId === g.id}
                    onClick={() => waitlist.onLetIn(g.id)}
                    aria-label={`Let in ${g.name}`}
                  >
                    {waitlist.lettingInId === g.id ? "Letting in…" : "Let in"}
                  </Button>
                ) : (
                  `${g.adds} ${g.adds === 1 ? "song" : "songs"}`
                )}
                {g.id !== meId && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-my-1"
                    autoFocus={kept === g.id}
                    onClick={() => setConfirming(g.id)}
                    aria-label={remove.named(g.name)}
                  >
                    <UserMinus />
                  </Button>
                )}
              </span>
            </div>
          )}
          {confirming === g.id && failed?.guestId === g.id && (
            <p role="alert" className="first-letter:uppercase pt-1 text-xs text-primary">
              {failed.error}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
