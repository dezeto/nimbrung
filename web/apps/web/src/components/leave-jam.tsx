import { LogOut } from "lucide-react";
import { useRef } from "react";

import { useLeave } from "@/hooks/use-session";

type Props = { roomName: string; code: string };

/**
 * A quiet door in the Queue's header, behind a confirm sheet so a stray tap
 * never drops anyone out of the jam.
 */
export function LeaveJam({ roomName, code }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const leave = useLeave(code);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Leave the jam"
        title="Leave the jam"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--nb-fg)/0.08)] t-2 shadow-[inset_0_0_0_1px_rgb(var(--nb-fg)/0.14)] hover:text-[var(--lg-ink)]"
      >
        <LogOut className="size-4" aria-hidden />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="leave-title"
        className="sheet glass-modal"
        // A tap on the dimmed page around the sheet closes it.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div className="grid gap-4 px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
          <div className="grid gap-1.5">
            <h2 id="leave-title" className="text-[20px] font-bold tracking-[-0.015em]">
              Leave {roomName}?
            </h2>
            <p className="text-[15px] t-2">
              Songs you added stay in the queue. Join again any time with the code{" "}
              <span translate="no" className="font-semibold tracking-[0.1em] text-[var(--lg-ink)]">
                {code}
              </span>
              .
            </p>
          </div>
          {leave.isError && (
            <p role="alert" className="first-letter:uppercase text-[13px] t-mine">
              {leave.error.message}
            </p>
          )}
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => leave.mutate()}
              disabled={leave.isPending}
              className="btn-plain is-primary h-12 text-[17px]"
            >
              {leave.isPending ? "Leaving…" : "Leave the jam"}
            </button>
            <button type="button" onClick={close} autoFocus className="btn-plain h-12 text-[17px]">
              Stay
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
