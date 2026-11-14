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

// All of them, spread across their own row. Never disabled while a tap is in flight: tapping fast is the point.
export function ReactionBar({ onReact }: { onReact: (reaction: Reaction) => void }) {
  return (
    <div role="group" aria-label="React to the song" className="flex justify-between">
      {REACTIONS.map((reaction) => (
        <button
          key={reaction}
          type="button"
          className="react"
          aria-label={REACTION_LOOKS[reaction].label}
          onClick={() => onReact(reaction)}
        >
          {REACTION_LOOKS[reaction].emoji}
        </button>
      ))}
    </div>
  );
}
