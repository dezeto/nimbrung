import { Link } from "@tanstack/react-router";

/** An artist's name that always opens something: their page, or a search for them when YouTube names no ID. */
export function ArtistLink({ name, id }: { name: string; id?: string }) {
  return id ? (
    <Link to="/artist/$artistId" params={{ artistId: id }} className="row-artist">
      {name}
    </Link>
  ) : (
    <Link to="/search" search={{ q: name }} className="row-artist">
      {name}
    </Link>
  );
}
