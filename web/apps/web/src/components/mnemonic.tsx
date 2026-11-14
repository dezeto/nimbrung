import type { Shortcut } from "@/hooks/use-shortcuts";

/**
 * A label whose shortcut letter gets underlined while Option/Alt is held
 * ("S̲kip"); see the data-mnemonics rule in index.css.
 */
export function Mnemonic({ label, shortcut }: { label: string; shortcut: Shortcut }) {
  const i = label.toLowerCase().indexOf(shortcut);
  if (i < 0) return label;
  return (
    <span>
      {label.slice(0, i)}
      <span className="mnemonic-key">{label[i]}</span>
      {label.slice(i + 1)}
    </span>
  );
}
