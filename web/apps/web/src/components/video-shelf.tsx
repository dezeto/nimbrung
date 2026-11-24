import type { LinkProps } from "@tanstack/react-router";

import type { Track } from "@/api/client";
import { ShelfTop } from "@/components/album-strip";
import { SearchRowStatus } from "@/components/search-row";
import { AddDisc } from "@/components/song-shelf";
import { formatDuration } from "@/lib/time";

type Props = {
  /** The heading's id, unique on the screen. */
  id: string;
  heading: string;
  videos: Track[];
  statusOf: (videoId: string) => SearchRowStatus;
  /** Why the last add failed, shown on its card. */
  error?: string;
  onAdd: (video: Track) => void;
  seeAll?: LinkProps;
};

/** A sideways strip of videos as wide pictures, each with its own +. Nothing when there are none. */
export function VideoShelf({ id, heading, videos, statusOf, error, onAdd, seeAll }: Props) {
  if (videos.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <ShelfTop id={id} heading={heading} seeAll={seeAll} />
      <ul className="shelf">
        {videos.map((video) => {
          const status = statusOf(video.videoId);
          return (
            <li key={video.videoId} className="video-card">
              <div className="video-art">
                {video.thumb && (
                  <img src={video.thumb} alt="" loading="lazy" className="size-full object-cover" />
                )}
                {video.duration > 0 && <span className="video-len">{formatDuration(video.duration)}</span>}
              </div>
              <AddDisc title={video.title} status={status} onAdd={() => onAdd(video)} />
              <p className="tile-title">{video.title}</p>
              {status === SearchRowStatus.Failed ? (
                <p role="alert" className="first-letter:uppercase text-xs t-mine">
                  {error}
                </p>
              ) : (
                <p className="tile-sub tabular-nums">{[video.artist, video.views].filter(Boolean).join(" · ")}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
