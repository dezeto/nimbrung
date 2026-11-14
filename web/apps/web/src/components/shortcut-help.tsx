import { Card } from "@web/ui/components/card";
import { useEffect, useRef } from "react";

import { Shortcut, type ShortcutAction, shortcutLabel } from "@/hooks/use-shortcuts";

type Props = { open: boolean; actions: ShortcutAction[]; onClose: () => void };

const kbd = "min-w-6 border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs";

/**
 * The `?` overlay listing this screen's shortcuts. A native modal <dialog>:
 * the browser moves focus in, keeps it there, and gives it back on close.
 */
export function ShortcutHelp({ open, actions, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-label="Keyboard shortcuts"
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself, not the card.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-full max-w-xs overflow-hidden rounded-[var(--lg-radius-lg)] bg-transparent p-0 text-foreground outline-none backdrop:bg-black/60"
    >
      <Card className="w-full gap-3 px-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <span className="text-xs text-muted-foreground">{shortcutLabel(Shortcut.Back)} to close</span>
        </div>
        <ul className="grid gap-2 text-sm">
          {actions.map(({ shortcuts, label }) => (
            <li key={label} className="flex items-center justify-between gap-4">
              {label}
              <span className="flex gap-1">
                {shortcuts.map((s) => (
                  <kbd key={s} className={kbd}>
                    {shortcutLabel(s)}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </dialog>
  );
}
