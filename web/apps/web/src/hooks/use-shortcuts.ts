import { useEffect, useEffectEvent, useState } from "react";

/** Shortcut keys; letters are lower-case KeyboardEvent.key values. */
export enum Shortcut {
  PlayPause = "p",
  Skip = "s",
  AddSong = "a",
  Queue = "q",
  CopyInvite = "c",
  Mute = "m",
  Search = "/",
  Back = "Escape",
  Help = "?",
}

/** One thing a screen can do from the keyboard; it may answer to more than one key. */
export type ShortcutAction = { shortcuts: Shortcut[]; label: string; run: () => void };

// Letters are Option/Alt + letter, like desktop mnemonics, so a stray key
// can't skip the party's song; holding Option/Alt reveals the underlined
// letters (see Mnemonic). "/", "?" and Esc work on their own.
const isLetter = (s: Shortcut) => /^[a-z]$/.test(s);
const isMac = navigator.userAgent.includes("Mac");
const typingTags = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const optionKey = "Alt";
const showMnemonics = (on: boolean) =>
  document.documentElement.toggleAttribute("data-mnemonics", on);

/** For aria-keyshortcuts. */
export const ariaShortcut = (s: Shortcut) => (isLetter(s) ? `Alt+${s.toUpperCase()}` : s);

/** For the help overlay: "⌥S" on a Mac, "Alt+S" elsewhere, "Esc". */
export function shortcutLabel(s: Shortcut) {
  if (s === Shortcut.Back) return "Esc";
  return isLetter(s) ? `${isMac ? "⌥" : "Alt+"}${s.toUpperCase()}` : s;
}

// Option+S types "ß" on a Mac, so with Option/Alt held read the physical key.
function pressedKey(e: KeyboardEvent) {
  if (!e.altKey) return e.key;
  return e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : undefined;
}

/**
 * Binds a screen's shortcuts for keyboard users, plus `?` for the help
 * overlay. Keys typed into a field are left alone (Escape just leaves the
 * field), and Cmd/Ctrl combos stay the browser's.
 */
export function useShortcuts(actions: ShortcutAction[]) {
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = () => setHelpOpen(true);
  const closeHelp = () => setHelpOpen(false);

  // While the overlay is open, keys only close it.
  function actionFor(key: string, alt: boolean) {
    if (helpOpen) return key === Shortcut.Back || key === Shortcut.Help ? closeHelp : undefined;
    if (key === Shortcut.Help) return openHelp;
    return actions.find((a) => a.shortcuts.some((s) => s === key && isLetter(s) === alt))?.run;
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === optionKey) showMnemonics(true);
    if (e.metaKey || e.ctrlKey || e.repeat) return;
    const t = e.target;
    if (t instanceof HTMLElement && (typingTags.has(t.tagName) || t.isContentEditable)) {
      if (e.key === Shortcut.Back) t.blur();
      return;
    }
    const key = pressedKey(e);
    const run = key && actionFor(key, e.altKey);
    if (!run) return;
    e.preventDefault();
    run();
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => onKeyDown(e);
    const up = (e: KeyboardEvent) => e.key === optionKey && showMnemonics(false);
    const hide = () => showMnemonics(false); // Option released while the window lost focus
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", hide);
      hide();
    };
  }, []);

  return { open: helpOpen, actions, onOpen: openHelp, onClose: closeHelp };
}
