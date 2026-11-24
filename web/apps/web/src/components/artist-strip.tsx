import { Link } from "@tanstack/react-router";
import { Skeleton } from "@web/ui/components/skeleton";
import { UserRound } from "lucide-react";

import type { ShelfArtist } from "@/hooks/use-artists";

type Props = {
  /** The heading's id, unique on the screen. */
  id: string;
  heading: string;
  artists: ShelfArtist[];
};

/** A sideways strip of artists; each opens their songs. Nothing when there are none. */
export function ArtistStrip({ id, heading, artists }: Props) {
  if (artists.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="shelf-heading">
        {heading}
      </h2>
      <ul className="shelf" aria-busy={artists.some((a) => !a.name)}>
        {artists.map((artist) => (
          <li key={artist.id}>
            {artist.name ? (
              <Link to="/artist/$artistId" params={{ artistId: artist.id }} className="artist-tile">
                <span className="artist-face">
                  {artist.thumb ? (
                    <img src={artist.thumb} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <UserRound className="size-7 t-2" aria-hidden />
                  )}
                </span>
                <span className="line-clamp-2 w-full break-words">{artist.name}</span>
              </Link>
            ) : (
              // Still asking YouTube who this is.
              <div className="artist-tile" aria-hidden>
                <Skeleton className="size-[72px] rounded-full" />
                <Skeleton className="h-3 w-12 rounded-full" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
