import { Link } from "@tanstack/react-router";
import { Check, Disc3, Link as LinkIcon, ListMusic, LoaderCircle, Music, Plus, RotateCw, Volume2 } from "lucide-react";

import { SearchRowStatus } from "@/components/search-row";
import { LinkKind, type PastedLink } from "@/lib/links";

type Props = {
  link: PastedLink;
  /** The link as typed, shown until YouTube says what it is. */
  url: string;
  /** What the link points at, once looked up; the card works without it. */
  title?: string;
  sub?: string;
  thumb?: string;
  /** A song link's add: its row status, plus "added" for the moment before the queue shows it. */
  status: SearchRowStatus;
  added: boolean;
  error?: string;
  onAdd: () => void;
  /** It's not a link we can use: search for the words instead. */
  onSearchAnyway: () => void;
};

/**
 * What a link pasted into the search box points at, with the one thing to do
 * with it: add a song, open a playlist or album. Anything else says so and
 * offers to search the text after all.
 */
export function LinkCard({ link, url, title, sub, thumb, status, added, error, onAdd, onSearchAnyway }: Props) {
  if (link.kind === LinkKind.OtherYouTube || link.kind === LinkKind.Elsewhere) {
    return (
      <section className="section link-card" aria-labelledby="link-title">
        <div className="grid gap-1">
          <p id="link-title" className="text-[17px] leading-[22px] font-semibold">
            {link.kind === LinkKind.Elsewhere
              ? "That isn’t a YouTube link"
              : "That link isn’t to a song, an album or a playlist"}
          </p>
          <p className="text-[13px] t-2">
            Paste a link from YouTube or YouTube Music, or search for the song by name.
          </p>
        </div>
        <button type="button" onClick={onSearchAnyway} className="btn-plain h-11 w-full text-[15px]">
          Search for it anyway
        </button>
      </section>
    );
  }

  const fallback =
    link.kind === LinkKind.Song ? "YouTube link" : link.kind === LinkKind.Album ? "An album" : "A playlist";
  return (
    <section className="section link-card" aria-labelledby="link-title">
      <p className="kicker">
        <LinkIcon className="size-3.5" aria-hidden /> From your link
      </p>
      <div className="flex items-center gap-3.5">
        <div className="link-art">
          {thumb ? (
            <img src={thumb} alt="" className="size-full object-cover" />
          ) : link.kind === LinkKind.Album ? (
            <Disc3 className="size-7 t-2" aria-hidden />
          ) : link.kind === LinkKind.Playlist ? (
            <ListMusic className="size-7 t-2" aria-hidden />
          ) : (
            <Music className="size-7 t-2" aria-hidden />
          )}
        </div>
        <div className="row-text">
          <p id="link-title" className="line-clamp-2 text-[17px] leading-[22px] font-semibold break-words">
            {title || fallback}
          </p>
          <p className="row-sub tabular-nums">{sub || url}</p>
        </div>
      </div>
      {link.kind === LinkKind.Album ? (
        <Link to="/album/$albumId" params={{ albumId: link.albumId }} className="btn-plain is-primary h-12 w-full text-[16px]">
          Open the album
        </Link>
      ) : link.kind === LinkKind.Playlist ? (
        <Link
          to="/playlist/$playlistId"
          params={{ playlistId: link.playlistId }}
          className="btn-plain is-primary h-12 w-full text-[16px]"
        >
          Open the playlist
        </Link>
      ) : (
        <SongAction status={status} added={added} error={error} onAdd={onAdd} />
      )}
    </section>
  );
}

/** The song link's one button, or what became of it. */
function SongAction({ status, added, error, onAdd }: Pick<Props, "status" | "added" | "error" | "onAdd">) {
  if (status === SearchRowStatus.Playing) {
    return (
      <p role="status" className="link-done t-mine">
        <Volume2 className="size-[18px]" aria-hidden /> Playing now
      </p>
    );
  }
  if (status === SearchRowStatus.Queued || added) {
    return (
      <p role="status" className="link-done">
        <Check className="size-[18px]" aria-hidden /> In the queue
      </p>
    );
  }
  const adding = status === SearchRowStatus.Adding;
  const failed = status === SearchRowStatus.Failed;
  return (
    <div className="grid gap-2">
      <button
        type="button"
        // Busy, not disabled: it stays visible while it works.
        onClick={() => !adding && onAdd()}
        aria-disabled={adding}
        className={`btn-plain is-primary h-12 w-full gap-2 text-[16px] ${adding ? "cursor-progress" : ""}`}
      >
        {adding ? (
          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : failed ? (
          <RotateCw className="size-5" aria-hidden />
        ) : (
          <Plus className="size-5" strokeWidth={2.2} aria-hidden />
        )}
        {adding ? "Adding…" : failed ? "Try again" : "Add to the queue"}
      </button>
      {failed && error && (
        <p role="alert" className="first-letter:uppercase text-center text-xs t-mine">
          {error}
        </p>
      )}
    </div>
  );
}
