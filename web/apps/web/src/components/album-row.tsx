import { Link } from "@tanstack/react-router";
import { ChevronRight, Disc3 } from "lucide-react";

import type { Album } from "@/api/client";

/** An album in search results ("Album · artist · year"); opens its songs. */
export function AlbumRow({ album }: { album: Album }) {
  return (
    <li className="row">
      <Link to="/album/$albumId" params={{ albumId: album.id }} className="row-link">
        <div className="thumb grid place-items-center">
          {album.thumb ? (
            <img src={album.thumb} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <Disc3 className="size-5 t-2" aria-hidden />
          )}
        </div>
        <div className="row-text">
          <p className="row-title">{album.title}</p>
          <p className="row-sub tabular-nums">
            {[album.kind || "Album", album.artist, album.year].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 t-2" aria-hidden />
      </Link>
    </li>
  );
}
