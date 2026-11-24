import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ListMusic } from "lucide-react";
import { useState } from "react";

import { api, type Played, Reaction } from "@/api/client";
import { REACTION_LOOKS } from "@/components/reaction-bar";
import { QueryKey } from "@/hooks/query-keys";
import { who } from "@/lib/who";
import { MadeWith } from "@/components/made-with";
import { backClass } from "@/components/page-header";

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
      <Link to="/" aria-label="Back to the jam" className={`${backClass} self-start text-[15px]`}>
        <ChevronLeft className="size-5" aria-hidden />
        Back
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
            <section
              aria-label="Most loved song"
              className="rounded-[24px] bg-[rgb(var(--nb-fg)/0.1)] p-3 shadow-[inset_0_0_0_1px_rgb(var(--nb-fg)/0.14)]"
            >
              <div className="flex items-center gap-3.5">
                <span className="size-20 shrink-0 overflow-hidden rounded-xl bg-[rgb(var(--nb-fg)/0.08)] shadow-[0_8px_24px_rgb(0_0_0/0.35)]">
                  {loved.thumb && <img src={loved.thumb} alt="" className="size-full object-cover" />}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-[0.1em] t-mine uppercase">Most loved song</p>
                  <p className="mt-0.5 line-clamp-2 text-[20px] leading-6 font-extrabold tracking-[-0.01em]">{loved.title}</p>
                  <p className="truncate text-[13px] t-2">
                    {loved.artist}
                    {loved.addedBy && ` · ${who(loved.addedBy, loved.addedByAvatar)}`}
                  </p>
                  <ul aria-label="Reactions" className="mt-2 flex flex-wrap gap-1">
                    {byCount(loved).map(([r, n]) => (
                      <li
                        key={r}
                        className="inline-flex h-7 items-center gap-1 rounded-full bg-[rgb(var(--nb-fg)/0.12)] px-2.5 text-[13px] font-semibold tabular-nums"
                      >
                        <span aria-hidden>{REACTION_LOOKS[r].emoji}</span>
                        <span>
                          {n}
                          <span className="sr-only"> {REACTION_LOOKS[r].label}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
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

          <section aria-labelledby="take-home" className="grid gap-2.5">
            <div>
              <h2 id="take-home" className="text-[15px] font-bold">
                Take tonight home
              </h2>
              {playlists.length > 1 && (
                <p className="text-[13px] t-2">YouTube opens {PLAYLIST_MAX} songs at a time.</p>
              )}
            </div>
            {playlists.length === 1 ? (
              <a
                href={playlistUrl(playlists[0])}
                target="_blank"
                rel="noreferrer"
                className="glass-btn is-primary is-capsule h-[52px] gap-2 text-base"
              >
                <ListMusic className="size-5" aria-hidden />
                Open as playlist
              </a>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {playlists.map((chunk, i) => (
                  <a
                    key={chunk[0]}
                    href={playlistUrl(chunk)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-plain min-h-11 tabular-nums"
                    aria-label={`Open songs ${i * PLAYLIST_MAX + 1} to ${i * PLAYLIST_MAX + chunk.length} as a playlist`}
                  >
                    <ListMusic className="size-4 t-2" aria-hidden />
                    {i * PLAYLIST_MAX + 1}–{i * PLAYLIST_MAX + chunk.length}
                  </a>
                ))}
              </div>
            )}
            <button type="button" onClick={copyList} className="btn-plain is-ghost min-h-11">
              {copied === "yes" ? "Copied" : copied === "no" ? "Couldn’t copy on this link" : "Copy song list"}
            </button>
            <p className="sr-only" role="status">
              {copied === "yes" ? "Song list copied" : ""}
            </p>
          </section>

          <section aria-labelledby="what-played">
            <h2 id="what-played" className="text-[15px] font-bold">
              What played <span className="font-normal t-2 tabular-nums">· {played.length}</span>
            </h2>
            <ol>
              {played.map((p) => (
                <li key={`${p.videoId}-${p.startedAt}`} className="row">
                  <div className="thumb">
                    {p.thumb && <img src={p.thumb} alt="" loading="lazy" className="size-full object-cover" />}
                  </div>
                  <div className="row-text">
                    <p className="row-title">{p.title}</p>
                    <p className="row-sub">
                      {p.artist}
                      {p.addedBy && ` · ${who(p.addedBy, p.addedByAvatar)}`}
                    </p>
                  </div>
                  <time dateTime={p.startedAt} className="text-[13px] tabular-nums t-2">
                    {new Date(p.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      <MadeWith className="mt-auto pt-8" />
    </main>
  );
}

type StatProps = { value: string; label: string; note?: string; titled?: boolean };

/** One number with its label; titled puts the label on top, as a heading. */
function Stat({ value, label, note, titled }: StatProps) {
  return (
    <div className={`flex rounded-[18px] bg-[rgb(var(--nb-fg)/0.08)] p-3 ${titled ? "flex-col" : "flex-col-reverse"}`}>
      <dt className={titled ? "text-xs font-bold tracking-[0.08em] t-2 uppercase" : "text-xs t-2"}>{label}</dt>
      <dd className={titled ? "mt-1 truncate text-lg font-bold" : "text-2xl font-extrabold tracking-[-0.02em] whitespace-nowrap tabular-nums"}>{value}</dd>
      {note && <dd className="text-[13px] t-2">{note}</dd>}
    </div>
  );
}

const playlistUrl = (ids: string[]) => `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;

function hoursMinutes(seconds: number) {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The song's reactions, biggest first. */
function byCount(p: Played) {
  return (Object.entries(p.reactions ?? {}) as [Reaction, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}
