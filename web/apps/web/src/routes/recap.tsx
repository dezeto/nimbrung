import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ListMusic } from "lucide-react";
import { useState } from "react";

import { api, type Played, Reaction } from "@/api/client";
import { REACTION_LOOKS } from "@/components/reaction-bar";
import { QueryKey } from "@/hooks/query-keys";
import { who } from "@/lib/who";

// Public like the Room view: what played is on the TV anyway.
export const Route = createFileRoute("/recap")({ component: RecapScreen });

// YouTube's watch_videos link takes 50 songs at most.
const PLAYLIST_MAX = 50;

const total = (p: Played) => Object.values(p.reactions ?? {}).reduce((a, n) => a + (n ?? 0), 0);

function RecapScreen() {
  const { data } = useQuery({ queryKey: [QueryKey.Recap], queryFn: api.recap, refetchInterval: 30_000 });
  const [copied, setCopied] = useState<"yes" | "no">();
  if (!data) return null;

  const played = data.played ?? [];
  const now = Date.parse(data.now);
  // A song lasts until the next one started, or its own length if that's shorter (paused, then skipped).
  const seconds = played.reduce((sum, p, i) => {
    const until = i + 1 < played.length ? Date.parse(played[i + 1].startedAt) : now;
    const heard = Math.max(0, (until - Date.parse(p.startedAt)) / 1000);
    return sum + (p.duration ? Math.min(heard, p.duration) : heard);
  }, 0);
  const reactions = played.reduce((sum, p) => sum + total(p), 0);
  const loved = played.reduce<Played | undefined>((best, p) => (total(p) > (best ? total(best) : 0) ? p : best), undefined);
  const adds = new Map<string, { p: Played; n: number }>();
  for (const p of played) {
    if (!p.addedById) continue;
    const dj = adds.get(p.addedById) ?? { p, n: 0 };
    adds.set(p.addedById, { p: dj.p, n: dj.n + 1 });
  }
  const topDj = [...adds.values()].sort((a, b) => b.n - a.n)[0];
  // The same song twice is one playlist entry.
  const ids = [...new Set(played.map((p) => p.videoId))];
  const playlists = Array.from({ length: Math.ceil(ids.length / PLAYLIST_MAX) }, (_, i) =>
    ids.slice(i * PLAYLIST_MAX, (i + 1) * PLAYLIST_MAX),
  );

  async function copyList() {
    try {
      await navigator.clipboard.writeText(played.map((p) => `${p.title} – ${p.artist}`).join("\n"));
      setCopied("yes");
    } catch {
      setCopied("no"); // no clipboard on a plain-http LAN link
    }
    setTimeout(() => setCopied(undefined), 2500);
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 px-4 pt-3 pb-8">
      <Link to="/" className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start px-2 text-[15px] t-2">
        <ChevronLeft className="size-5" aria-hidden />
        Back to the jam
      </Link>
      <header>
        <p className="text-[13px] font-bold tracking-[0.12em] t-2 uppercase">
          Tonight · {new Date(now).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
        </p>
        <h1 className="mt-1 text-[30px] leading-9 font-extrabold tracking-[-0.025em] text-balance break-words">
          {data.name}
        </h1>
      </header>

      {played.length === 0 ? (
        <p className="py-8 text-center text-sm t-2">Nothing has played yet. The recap fills in as songs play.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Stat value={hoursMinutes(seconds)} label="of music" />
            <Stat value={String(played.length)} label={played.length === 1 ? "song played" : "songs played"} />
            <Stat value={String(reactions)} label={reactions === 1 ? "reaction" : "reactions"} />
          </dl>

          {loved && (
            <section aria-label="Most loved song" className="flex items-center gap-3 rounded-[20px] bg-[rgb(var(--nb-fg)/0.1)] p-3 shadow-[inset_0_0_0_1px_rgb(var(--nb-fg)/0.14)]">
              <span className="size-16 shrink-0 overflow-hidden rounded-xl bg-[rgb(var(--nb-fg)/0.08)]">
                {loved.thumb && <img src={loved.thumb} alt="" className="size-full object-cover" />}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-[0.08em] t-mine uppercase">Most loved song</p>
                <p className="truncate text-[17px] font-bold">{loved.title}</p>
                <p className="truncate text-[13px] t-2">
                  {topReactions(loved)}
                  {loved.addedBy && ` · added by ${who(loved.addedBy, loved.addedByAvatar)}`}
                </p>
              </div>
            </section>
          )}

          <dl className="grid grid-cols-2 gap-2">
            {topDj && (
              <Stat
                label="Top DJ"
                value={who(topDj.p.addedBy, topDj.p.addedByAvatar)}
                note={`${topDj.n} ${topDj.n === 1 ? "song" : "songs"} added`}
                titled
              />
            )}
            <Stat label="In the jam" value={`${data.people} ${data.people === 1 ? "person" : "people"}`} titled />
          </dl>

          <section aria-labelledby="what-played" className="grid gap-1.5">
            <h2 id="what-played" className="px-1 text-[15px] font-bold">
              What played
            </h2>
            <ol className="grid gap-1.5">
              {played.map((p, i) => (
                <li key={`${p.videoId}-${p.startedAt}`} className="flex items-center gap-2.5 text-sm">
                  <span className="w-6 shrink-0 text-right tabular-nums t-2">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{p.title}</span>
                    <span className="t-2"> · {p.artist}</span>
                  </span>
                  {p.addedByAvatar && (
                    <span role="img" aria-label={`added by ${p.addedBy}`}>
                      {p.addedByAvatar}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <div className="sticky bottom-4 mt-auto grid gap-2.5 pt-2">
            {playlists.map((chunk, i) => (
              <a
                key={chunk[0]}
                href={`https://www.youtube.com/watch_videos?video_ids=${chunk.join(",")}`}
                target="_blank"
                rel="noreferrer"
                className="glass-btn is-primary is-capsule h-[54px] gap-2 text-base"
              >
                <ListMusic className="size-5" aria-hidden />
                {playlists.length === 1
                  ? "Open as playlist"
                  : `Open songs ${i * PLAYLIST_MAX + 1}–${i * PLAYLIST_MAX + chunk.length}`}
              </a>
            ))}
            <button type="button" onClick={copyList} className="glass-btn is-capsule h-12 text-[15px]">
              {copied === "yes" ? "Copied" : copied === "no" ? "Couldn’t copy on this link" : "Copy song list"}
            </button>
            <p className="sr-only" role="status">
              {copied === "yes" ? "Song list copied" : ""}
            </p>
          </div>
        </>
      )}
    </main>
  );
}

type StatProps = { value: string; label: string; note?: string; titled?: boolean };

/** One number with its label; titled puts the label on top, as a heading. */
function Stat({ value, label, note, titled }: StatProps) {
  return (
    <div className={`flex rounded-[18px] bg-[rgb(var(--nb-fg)/0.08)] p-3 ${titled ? "flex-col" : "flex-col-reverse"}`}>
      <dt className={titled ? "text-xs font-bold tracking-[0.08em] t-2 uppercase" : "text-xs t-2"}>{label}</dt>
      <dd className={titled ? "mt-1 truncate text-lg font-bold" : "text-2xl font-extrabold tabular-nums"}>{value}</dd>
      {note && <dd className="text-[13px] t-2">{note}</dd>}
    </div>
  );
}

function hoursMinutes(seconds: number) {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "🔥 41 · ❤️ 28": the song's two biggest reactions. */
function topReactions(p: Played) {
  return Object.entries(p.reactions ?? {})
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 2)
    .map(([r, n]) => `${REACTION_LOOKS[r as Reaction].emoji} ${n}`)
    .join(" · ");
}
