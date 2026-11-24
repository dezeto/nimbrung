import { Link2 } from "lucide-react";
import { type FormEvent, useState } from "react";

type Props = {
  link: string;
  onLinkChange: (link: string) => void;
  onSubmit: () => void;
  /** The link is a playlist's: the button opens it instead of adding. */
  opensPlaylist: boolean;
  pending: boolean;
  error?: string;
  added: boolean;
};

/** "Paste a link": closed until asked for, then a small form for a YouTube link. */
export function PasteLink({ link, onLinkChange, onSubmit, opensPlaylist, pending, error, added }: Props) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-2 self-start px-1 text-[15px] font-medium t-2 hover:text-[var(--lg-ink)]"
      >
        <Link2 className="size-[18px]" aria-hidden /> Paste a link
      </button>
    );
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }
  return (
    <section className="section flex flex-col px-4 pb-4">
      <form onSubmit={submit} className="flex flex-col gap-2.5 pt-3.5">
        <label htmlFor="link" className="flex items-center gap-2.5 text-[15px] font-semibold">
          <Link2 className="size-5 text-[var(--nb-accent-text)]" aria-hidden /> Got a link?
        </label>
        <p className="text-[13px] t-2">
          Paste a YouTube or YouTube Music link to a song or a playlist, or use Share → Nimbrung
          from the app.
        </p>
        <div className="mt-0.5 flex gap-2">
          <div className="field-inset min-w-0 flex-1">
            <input
              id="link"
              type="url"
              name="url"
              required
              value={link}
              onChange={(e) => onLinkChange(e.target.value)}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              placeholder="https://music.youtube.com/watch?v=…"
              className="text-sm"
            />
          </div>
          <button type="submit" disabled={pending} className="btn-plain is-primary h-11 px-[18px] text-[15px]">
            {opensPlaylist ? "Open" : pending ? "Adding…" : "Add"}
          </button>
        </div>
        {error && (
          <p role="alert" className="first-letter:uppercase text-xs t-mine">
            {error}
          </p>
        )}
        {added && (
          <p role="status" className="text-xs t-2">
            Added to the queue ✓
          </p>
        )}
      </form>
    </section>
  );
}
