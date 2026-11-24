import { Crown, Users } from "lucide-react";
import { useRef } from "react";

import type { Guest } from "@/api/client";
import { who } from "@/lib/who";

type Props = { guests: Guest[]; meId: string };

/** The guest count in the Queue's header; a tap opens who's in the jam. Read-only: removing is /host's. */
export function WhosHere({ guests, meId }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${guests.length} in the jam`}
        title="Who’s here"
        onClick={() => dialog.current?.showModal()}
        className="-m-2 inline-flex shrink-0 items-center gap-1 p-2 text-[13px] tabular-nums t-2 hover:text-[var(--lg-ink)]"
      >
        <Users className="size-4" aria-hidden />
        {guests.length}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="whos-here-title"
        className="sheet glass-modal"
        // A tap on the dimmed page around the sheet closes it.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div className="grid gap-4 px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <h2 id="whos-here-title" className="text-center text-[20px] font-bold tracking-[-0.015em]">
            In the jam · <span className="tabular-nums">{guests.length}</span>
          </h2>
          <ul className="max-h-[50svh] divide-y divide-[rgb(var(--nb-fg)/0.1)] overflow-y-auto text-[15px]">
            {guests.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{who(g.name, g.avatar)}</span>
                  {g.id === meId && <span className="shrink-0 t-2">(you)</span>}
                  {g.isHost && (
                    <>
                      <Crown className="size-3.5 shrink-0 text-[#FF3B3B]" aria-hidden />
                      <span className="sr-only">(host)</span>
                    </>
                  )}
                </span>
                <span className="shrink-0 text-[13px] tabular-nums t-2">
                  {g.adds} {g.adds === 1 ? "song" : "songs"}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={close} autoFocus className="btn-plain h-12 text-[17px]">
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}
