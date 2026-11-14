import { Link } from "@tanstack/react-router";
import { ChevronRight, ListMusic } from "lucide-react";

import type { Playlist } from "@/api/client";

/** A playlist in search results; opens its songs. q is the search to come back to. */
export function PlaylistRow({ playlist, q }: { playlist: Playlist; q: string }) {
  return (
    <li className="row">
      <Link
        to="/playlist/$playlistId"
        params={{ playlistId: playlist.id }}
        search={{ q }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="thumb grid place-items-center">
          {playlist.thumb ? (
            <img src={playlist.thumb} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <ListMusic className="size-5 t-2" />
          )}
        </div>
        <div className="row-text">
          <p className="row-title">{playlist.title}</p>
          <p className="row-sub">
            {["Playlist", playlist.author].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 t-2" />
      </Link>
    </li>
  );
}
