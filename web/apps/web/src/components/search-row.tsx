import { Link } from "@tanstack/react-router";
import { Check, Heart, LoaderCircle, Plus, RotateCw, Volume2 } from "lucide-react";

import type { Track } from "@/api/client";
import { SaveButton } from "@/components/save-button";
import { formatDuration } from "@/lib/time";

export enum SearchRowStatus {
  Add = "add",
  Adding = "adding",
  Failed = "failed",
  Queued = "queued",
  Playing = "playing",
}

type Props = {
  track: Track;
  status: SearchRowStatus;
  error?: string;
  onAdd: () => void;
  saved: boolean;
  /** Shows the heart button (the Saved list, to take songs off). Elsewhere a saved song just gets a small heart. */
  onSave?: () => void;
  /** Says the album too: for rows that otherwise read the same as a neighbour. */
  showAlbum?: boolean;
  /** A few quiet words after the length, e.g. "played tonight". */
  note?: string;
  /** False on the artist's own page, where their name leads nowhere new. */
  linkArtist?: boolean;
  /** False where the page already says who it's by (an album, an artist's page). */
  showArtist?: boolean;
  /** A video: a 16:9 picture instead of a square cover. */
  wide?: boolean;
  /** Its place on an album, shown instead of the cover. */
  trackNo?: number;
  /** Letters of the title to mark, [start, end): what a filter matched. */
  mark?: [number, number];
};

export function SearchRow({
  track,
  status,
  error,
  onAdd,
  saved,
  onSave,
  showAlbum,
  note,
  linkArtist = true,
  showArtist = true,
  wide,
  trackNo,
  mark,
}: Props) {
  const playing = status === SearchRowStatus.Playing;
  // The heart's 44px box is mostly air: tuck the + slot against it.
  const slot = `size-10 shrink-0 -mr-1.5 ${onSave ? "-ml-3" : ""}`;
  const artist = showArtist ? track.artist : "";
  const details = [
    showAlbum && track.album,
    track.views,
    track.duration > 0 && formatDuration(track.duration),
    note,
  ].filter(Boolean);
  return (
    <li className={`row ${wide ? "is-wide" : ""} ${trackNo ? "is-numbered" : ""}`}>
      {trackNo ? (
        // The playing song shows a speaker where its number was.
        <span className="track-no">
          {playing ? <Volume2 className="size-4 text-[var(--nb-accent)]" aria-hidden /> : trackNo}
        </span>
      ) : (
        <div className={`thumb ${wide ? "wide" : ""}`}>
          {track.thumb && <img src={track.thumb} alt="" loading="lazy" className="size-full object-cover" />}
        </div>
      )}
      <div className="row-text">
        <p className="row-title">{mark ? <Marked text={track.title} range={mark} /> : track.title}</p>
        <p className="row-sub flex items-center gap-1 tabular-nums">
          {saved && !onSave && (
            <Heart className="size-3 shrink-0 fill-current text-[var(--nb-accent)]" aria-label="Saved" />
          )}
          <span className="truncate">
            {artist && track.artistId && linkArtist ? (
              <Link to="/artist/$artistId" params={{ artistId: track.artistId }} className="row-artist">
                {artist}
              </Link>
            ) : (
              artist
            )}
            {artist && details.length > 0 && " · "}
            {details.join(" · ")}
          </span>
        </p>
        {status === SearchRowStatus.Failed && (
          <p role="alert" className="first-letter:uppercase text-xs t-mine">
            {error}
          </p>
        )}
      </div>
      {onSave && <SaveButton title={track.title} saved={saved} onToggle={onSave} />}
      {playing ? (
        // Icons in the +'s own 40px slot, so nothing shifts when a song goes in.
        <span className={`grid place-items-center t-mine ${slot}`} role="img" aria-label="Playing" title="Playing">
          <Volume2 className="size-4" />
        </span>
      ) : status === SearchRowStatus.Queued ? (
        <span className={`grid place-items-center t-2 ${slot}`} role="img" aria-label="Queued" title="Queued">
          <Check className="size-4" strokeWidth={2.6} />
        </span>
      ) : (
        <button
          type="button"
          // A round + like a music app's list, not a labelled pill per row.
          // Busy, not disabled: it stays visible while it works.
          // A 28px disc inside a 40px tap target: big enough to hit, quiet next to the heart.
          className={`btn-plain bg-clip-content p-1.5 ${slot} ${status === SearchRowStatus.Adding ? "is-busy" : ""}`}
          onClick={() => status !== SearchRowStatus.Adding && onAdd()}
          aria-disabled={status === SearchRowStatus.Adding}
          aria-label={`${status === SearchRowStatus.Failed ? "Retry adding" : status === SearchRowStatus.Adding ? "Adding" : "Add"} ${track.title}`}
          title={status === SearchRowStatus.Failed ? "Retry" : "Add to the queue"}
        >
          {status === SearchRowStatus.Adding ? (
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          ) : status === SearchRowStatus.Failed ? (
            <RotateCw className="size-4" />
          ) : (
            <Plus className="size-3.5" strokeWidth={2.6} />
          )}
        </button>
      )}
    </li>
  );
}

/** The title with the matched letters marked. */
function Marked({ text, range: [start, end] }: { text: string; range: [number, number] }) {
  return (
    <>
      {text.slice(0, start)}
      <mark className="mark">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
