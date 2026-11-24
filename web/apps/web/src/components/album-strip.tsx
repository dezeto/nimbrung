import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight, Disc3 } from "lucide-react";

import type { Album } from "@/api/client";

type Props = {
  /** The heading's id, unique on the screen. */
  id: string;
  heading: string;
  albums: Album[];
  /** The line under each title: "artist · year" in search, just the year on the artist's page. */
  sub: (album: Album) => string;
  /** Where "See all" goes; no link without it. */
  seeAll?: LinkProps;
};

/** A sideways strip of album covers; each opens its songs. Nothing when there are none. */
export function AlbumStrip({ id, heading, albums, sub, seeAll }: Props) {
  if (albums.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <ShelfTop id={id} heading={heading} seeAll={seeAll} />
      <ul className="shelf">
        {albums.map((album) => (
          <li key={album.id}>
            <Link to="/album/$albumId" params={{ albumId: album.id }} className="album-tile">
              <span className="album-art">
                {album.thumb ? (
                  <img src={album.thumb} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <Disc3 className="size-8 t-2" aria-hidden />
                )}
              </span>
              <span className="tile-title">{album.title}</span>
              <span className="tile-sub tabular-nums">{sub(album)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A shelf's heading, with "See all" on the right when there's more behind it. */
export function ShelfTop({ id, heading, seeAll }: { id: string; heading: string; seeAll?: LinkProps }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 id={id} className="shelf-heading">
        {heading}
      </h2>
      {seeAll && (
        <Link {...seeAll} className="see-all" aria-label={`See all ${heading.toLowerCase()}`}>
          See all <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
