import { Check, LoaderCircle, Plus, RotateCw, Volume2 } from "lucide-react";

import type { Track } from "@/api/client";
import { SearchRowStatus } from "@/components/search-row";

type Props = {
  /** The heading's id, unique on the screen. */
  id: string;
  heading: string;
  /** One line under the heading: why these songs. */
  sub?: string;
  tracks: Track[];
  statusOf: (videoId: string) => SearchRowStatus;
  /** Why the last add failed, shown on its card. */
  error?: string;
  onAdd: (track: Track) => void;
};

/** A sideways strip of songs as covers, each with its own +. Nothing when there are none. */
export function SongShelf({ id, heading, sub, tracks, statusOf, error, onAdd }: Props) {
  if (tracks.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="shelf-heading">
        {heading}
      </h2>
      {sub && <p className="truncate px-1 pt-0.5 text-[13px] t-2">{sub}</p>}
      <ul className="shelf">
        {tracks.map((track) => {
          const status = statusOf(track.videoId);
          return (
            <li key={track.videoId} className="song-card">
              <div className="song-art">
                {track.thumb && (
                  <img src={track.thumb} alt="" loading="lazy" className="size-full object-cover" />
                )}
              </div>
              <AddDisc title={track.title} status={status} onAdd={() => onAdd(track)} />
              <p className="row-title mt-2">{track.title}</p>
              {status === SearchRowStatus.Failed ? (
                <p role="alert" className="first-letter:uppercase text-xs t-mine">
                  {error}
                </p>
              ) : (
                <p className="row-sub">{track.artist}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The + on a cover. Once the song is in the queue it's a mark, not a button. */
function AddDisc({ title, status, onAdd }: { title: string; status: SearchRowStatus; onAdd: () => void }) {
  if (status === SearchRowStatus.Playing) {
    return (
      <span className="song-add is-playing" role="img" aria-label="Playing">
        <Volume2 className="size-[18px]" />
      </span>
    );
  }
  if (status === SearchRowStatus.Queued) {
    return (
      <span className="song-add" role="img" aria-label="Queued">
        <Check className="size-[18px]" />
      </span>
    );
  }
  const adding = status === SearchRowStatus.Adding;
  const failed = status === SearchRowStatus.Failed;
  return (
    <button
      type="button"
      className="song-add"
      // Busy, not disabled: it stays visible while it works.
      onClick={() => !adding && onAdd()}
      aria-disabled={adding}
      aria-label={`${failed ? "Retry adding" : adding ? "Adding" : "Add"} ${title}`}
      title={failed ? "Retry" : "Add to the queue"}
    >
      {adding ? (
        <LoaderCircle className="size-[18px] animate-spin motion-reduce:animate-none" />
      ) : failed ? (
        <RotateCw className="size-[18px]" />
      ) : (
        <Plus className="size-5" strokeWidth={2.2} />
      )}
    </button>
  );
}
