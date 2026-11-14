import { useNavigate } from "@tanstack/react-router";
import { Heart, HeartCrack } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Props = { title: string; saved: boolean; onToggle: () => void };

/** The heart: puts a song on this phone's Saved list, or takes it off. */
export function SaveButton({ title, saved, onToggle }: Props) {
  const navigate = useNavigate();
  // Bumped on every save (or unsave) so the pop and the floating heart play again.
  const [burst, setBurst] = useState(0);
  const [broke, setBroke] = useState(0);

  function onClick() {
    onToggle();
    if (saved) {
      setBroke((n) => n + 1);
      toast("Removed from Saved", { action: { label: "Undo", onClick: onToggle } });
      return;
    }
    setBurst((n) => n + 1);
    toast("Saved to your list", {
      action: { label: "View", onClick: () => void navigate({ to: "/saved" }) },
    });
  }

  return (
    <button
      type="button"
      className="icon-btn relative"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={`Save ${title}`}
    >
      <Heart key={burst} className={saved ? "save-pop size-5 fill-current" : "size-5"} />
      {broke > 0 && (
        <HeartCrack key={`break-${broke}`} aria-hidden className="save-break size-5 fill-current" />
      )}
      {burst > 0 && (
        <Heart key={`float-${burst}`} aria-hidden className="save-float size-5 fill-current" />
      )}
    </button>
  );
}
