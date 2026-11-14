import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ListMusic, MessageSquareQuote } from "lucide-react";
import { useState } from "react";

import { FeedKind } from "@/api/client";
import { AutoplayMark } from "@/components/autoplay-mark";
import { LiveStage } from "@/components/live-stage";
import Loader from "@/components/loader";
import { LyricsLines } from "@/components/lyrics-lines";
import { QrCode } from "@/components/qr-code";
import { useLiveMoments } from "@/hooks/use-live";
import { useLyrics, useSongTime } from "@/hooks/use-lyrics";
import { useRoomState } from "@/hooks/use-room-state";
import { roomInfoQuery } from "@/hooks/use-session";
import { inviteUrl } from "@/lib/links";
import { splitQueue } from "@/lib/queue";
import { formatDuration } from "@/lib/time";
import { who } from "@/lib/who";

// The big screen in the room: what's playing, what's next, and the QR to
// join, readable from across the room. Needs no guest: the QR and code show
// where the server tells them, on the host's computer or a browser that
// joined, and anywhere else the card says where to open it.
export const Route = createFileRoute("/room")({
  component: RoomView,
});

const NEXT_SHOWN = 3;

function RoomView() {
  // Polled like /host: if the laptop changes Wi-Fi, the QR follows.
  const { data: info } = useQuery({ ...roomInfoQuery, refetchInterval: 15_000 });
  const room = useRoomState();
  const moments = useLiveMoments("");
  const np = room?.nowPlaying ?? null;
  const lyrics = useLyrics(np?.videoId);
  const time = useSongTime(np);
  const [lyricsOn, setLyricsOn] = useState(true);
  if (!room || !info) return <Loader />;
  // Karaoke when the song has lyrics and nobody switched to the queue.
  const hasLyrics = !!lyrics.data;
  const showLyrics = lyricsOn && hasLyrics;

  const { upNext, autoplay } = splitQueue(room.queue ?? []);
  // Nothing picked? Show where autoplay goes, so the column is never empty.
  const next = (upNext.length > 0 ? upNext : autoplay).slice(0, NEXT_SHOWN);
  const latest = (room.feed ?? []).findLast((e) => e.kind === FeedKind.Comment);
  const invite = inviteUrl(info);
  const elapsed = np ? (np.duration > 0 ? Math.min(np.elapsed, np.duration) : np.elapsed) : 0;
  const guests = room.guests?.length ?? 0;

  return (
    <main className="grid min-h-svh grid-cols-[minmax(0,1fr)_minmax(300px,360px)] gap-x-14 px-14 pt-6 pb-14">
      <LiveStage {...moments}>
        <div className="flex min-w-0 flex-col gap-10">
          <div className="flex items-center gap-3">
            <Link to="/host" className="glass-btn is-capsule glass-rim h-11 gap-1 pr-4 pl-2.5">
              <ChevronLeft className="size-5" /> Host
            </Link>
            {hasLyrics && (
              <div role="group" aria-label="Show" className="ml-auto flex gap-2">
                <button type="button" aria-pressed={showLyrics} className="btn-plain h-11 px-4" onClick={() => setLyricsOn(true)}>
                  <MessageSquareQuote className="ico size-4" /> Lyrics
                </button>
                <button type="button" aria-pressed={!showLyrics} className="btn-plain h-11 px-4" onClick={() => setLyricsOn(false)}>
                  <ListMusic className="ico size-4" /> Up next
                </button>
              </div>
            )}
          </div>
          {showLyrics && np ? (
            <div className="flex min-h-0 min-w-0 gap-12">
              <div className="flex w-[min(360px,26vw)] shrink-0 flex-col gap-4">
                <div className="aspect-square w-full overflow-hidden rounded-[28px] bg-[rgb(var(--nb-fg)/0.08)] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7),inset_0_0_0_1px_rgb(255_255_255/0.12)]">
                  {np.thumb && <img src={np.thumb} alt="" className="size-full object-cover" />}
                </div>
                <h1 className="text-[36px] leading-[1.1] font-bold tracking-[-0.025em] text-balance">{np.title}</h1>
                <p className="truncate text-[24px] leading-8 t-2">{np.artist}</p>
                <p className="text-[20px] leading-7 t-2">
                  {np.addedBy ? (
                    <>
                      Added by <span className="font-semibold text-[var(--lg-ink)]">{who(np.addedBy, np.addedByAvatar)}</span>
                    </>
                  ) : (
                    <AutoplayMark labelled />
                  )}
                </p>
                {np.duration > 0 && (
                  <div className="flex items-center gap-3 text-base font-semibold tabular-nums t-2">
                    <span>{formatDuration(elapsed)}</span>
                    <div className="progress h-1.5 flex-1">
                      <i style={{ width: `${(elapsed / np.duration) * 100}%` }} />
                    </div>
                    <span>{formatDuration(np.duration)}</span>
                  </div>
                )}
              </div>
              {/* LyricsLines scrolls on its own, so following the song never scrolls the page. */}
              <div className="h-[calc(100svh-150px)] min-w-0 flex-1">
                <LyricsLines lyrics={lyrics.data} loading={false} time={time} big />
              </div>
            </div>
          ) : (
          <>
          <div className="flex min-w-0 items-end gap-10">
            <div className="aspect-square w-[min(400px,32vw)] shrink-0 overflow-hidden rounded-[28px] bg-[rgb(var(--nb-fg)/0.08)] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7),inset_0_0_0_1px_rgb(255_255_255/0.12)]">
              {np?.thumb && <img src={np.thumb} alt="" className="size-full object-cover" />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {latest && (
                <p className="mb-4 self-start rounded-full bg-[var(--lg-bg-elevated)] px-6 py-3 text-[22px] leading-7 shadow-[inset_0_0_0_1px_var(--lg-border-color)]">
                  <b className="mr-2 font-bold">{who(latest.name, latest.avatar)}</b>
                  {latest.text}
                </p>
              )}
              {np ? (
                <>
                  <h1 className="text-[64px] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
                    {np.title}
                  </h1>
                  <p className="truncate text-[30px] leading-9 t-2">{np.artist}</p>
                  <p className="text-[26px] leading-8 t-2">
                    {np.addedBy ? (
                      <>
                        Added by <span className="font-semibold text-[var(--lg-ink)]">{who(np.addedBy, np.addedByAvatar)}</span>
                      </>
                    ) : (
                      <AutoplayMark labelled />
                    )}
                  </p>
                  {np.duration > 0 && (
                    <div className="mt-4 flex items-center gap-4 text-xl font-semibold tabular-nums t-2">
                      <span>{formatDuration(elapsed)}</span>
                      <div className="progress h-2 flex-1">
                        <i style={{ width: `${(elapsed / np.duration) * 100}%` }} />
                      </div>
                      <span>{formatDuration(np.duration)}</span>
                    </div>
                  )}
                </>
              ) : (
                <h1 className="text-[48px] leading-tight font-bold t-2">Nothing playing yet</h1>
              )}
            </div>
          </div>
          {next.length > 0 && (
            <section aria-labelledby="room-next">
              <h2 id="room-next" className="pb-4 text-[28px] leading-[34px] font-bold tracking-[-0.025em]">
                {upNext.length > 0 ? "Up next" : "Autoplay next"}
              </h2>
              <ul className="grid grid-cols-3 gap-6">
                {next.map((item, i) => (
                  <li key={`${item.videoId}-${i}`} className="flex min-w-0 items-center gap-5">
                    <div className="size-[72px] shrink-0 overflow-hidden rounded-[14px] bg-[rgb(var(--nb-fg)/0.1)]">
                      {item.thumb && <img src={item.thumb} alt="" className="size-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[26px] leading-8 font-semibold">{item.title}</p>
                      <p className="truncate text-[20px] leading-7 t-2">
                        {item.artist}
                        {item.addedBy && ` · ${who(item.addedBy, item.addedByAvatar)}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          </>
          )}
        </div>
      </LiveStage>

      <aside
        aria-label="Join the jam"
        className="glass-card glass-rim mt-[84px] flex flex-col items-center gap-5 self-start px-5 pt-8 pb-6"
        style={{ borderRadius: 34 }}
      >
        {invite ? (
          <>
            <p className="text-[26px] leading-8 font-semibold">Scan to join</p>
            <QrCode value={invite} className="w-full rounded-[20px]" />
            <p translate="no" className="-mr-[0.3em] font-mono text-[64px] leading-none font-semibold tracking-[0.3em]">
              {info.code}
            </p>
            <p className="max-w-full truncate text-xl t-2">{invite.replace(/^https?:\/\//, "")}</p>
          </>
        ) : (
          <p className="text-center text-xl t-2">
            Open the room view on the host’s computer to show the join QR here.
          </p>
        )}
        <p className="w-full border-t border-[var(--nb-separator)] pt-5 text-center text-[22px] font-semibold tabular-nums">
          {guests} in the jam
        </p>
      </aside>
    </main>
  );
}
