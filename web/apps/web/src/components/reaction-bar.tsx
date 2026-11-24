import { SmilePlus } from "lucide-react";
import { type FocusEvent, useEffect, useId, useRef, useState } from "react";

import { Reaction } from "@/api/client";

/** How each reaction is drawn; the server only knows the Reaction name. */
export const REACTION_LOOKS: Record<Reaction, { emoji: string; label: string }> = {
  [Reaction.Fire]: { emoji: "🔥", label: "Fire" },
  [Reaction.Heart]: { emoji: "❤️", label: "Love it" },
  [Reaction.Laugh]: { emoji: "😂", label: "Haha" },
  [Reaction.Clap]: { emoji: "👏", label: "Applause" },
  [Reaction.Dance]: { emoji: "💃", label: "Dance" },
  [Reaction.Party]: { emoji: "🎉", label: "Party" },
};

const REACTIONS = Object.values(Reaction);

/**
 * One button that opens a tray of reactions above it, held by the nearest
 * positioned parent (the row's right-hand group). The tray stays open
 * while reacting, since tapping fast is the point, and closes on a tap or
 * focus elsewhere, or Escape (which hands focus back to the button).
 * Reactions are never disabled while a tap is in flight.
 */
export function ReactionBar({ onReact }: { onReact: (reaction: Reaction) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const trayId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Unmounting the tray would drop focus on the page; give it back to the button.
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  // Tabbing out of the button and the tray closes it, like a tap elsewhere.
  const onBlur = (e: FocusEvent) => {
    if (e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return (
    <div ref={root} className="contents" onBlur={onBlur}>
      <button
        ref={trigger}
        type="button"
        className="btn-plain react-trigger h-9 w-12 shrink-0 p-0"
        aria-label="React"
        title="React"
        aria-expanded={open}
        aria-controls={open ? trayId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <SmilePlus className="size-[18px]" />
      </button>
      {/* After the button, so Tab goes from it straight into the reactions. */}
      {open && (
        <div id={trayId} role="group" aria-label="React to the song" className="glass-group glass-rim react-tray">
          {REACTIONS.map((reaction) => (
            <button
              key={reaction}
              type="button"
              className="react"
              aria-label={REACTION_LOOKS[reaction].label}
              title={REACTION_LOOKS[reaction].label}
              onClick={() => onReact(reaction)}
            >
              {REACTION_LOOKS[reaction].emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
