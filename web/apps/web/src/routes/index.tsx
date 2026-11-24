import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, Heart, Plus, SkipForward, Sparkles } from "lucide-react";

import { AutoplayList } from "@/components/autoplay-list";
import { EmptyQueue } from "@/components/empty-queue";
import { ChatSheet } from "@/components/chat-sheet";
import { LeaveJam } from "@/components/leave-jam";
import { LiveControls } from "@/components/live-controls";
import { LiveStage } from "@/components/live-stage";
import Loader from "@/components/loader";
import { StickyMiniPlayer } from "@/components/mini-player";
import { MadeWith } from "@/components/made-with";
import { Mnemonic } from "@/components/mnemonic";
import { NowPlayingCard } from "@/components/now-playing";
import { ReorderableQueue } from "@/components/reorderable-queue";
import { ShortcutHelp } from "@/components/shortcut-help";
import { ShuffleButton } from "@/components/shuffle-button";
import { NUDGE_LOOKS, VolumeNudges, myNudge } from "@/components/volume-nudges";
import { WhosHere } from "@/components/whos-here";
import { useComment, useLiveMoments, useNudge, useReact } from "@/hooks/use-live";
import { useMoveSong, useRemoveSong, useVoteSkip } from "@/hooks/use-queue";
import { useRoomState } from "@/hooks/use-room-state";
import { useSaved } from "@/hooks/use-saved";
import { meQuery, requireGuest, roomInfoQuery, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { aboutMinutes, splitQueue, totalSeconds } from "@/lib/queue";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: QueueScreen,
});

function QueueScreen() {
  const { data: me } = useSuspenseQuery(meQuery);
  const room = useRoomState();
  // Not in the stream, which anyone can read: the room info tells it to guests.
  const code = useQuery(roomInfoQuery).data?.code ?? "";
  const removeSong = useRemoveSong();
  const moveSong = useMoveSong();
  const skip = useVoteSkip(room?.nowPlaying?.videoId, room?.skipVotes ?? 0);
  const { isSaved, toggle } = useSaved();
  const navigate = useNavigate();
  const np = room?.nowPlaying ?? null;

  function voteSkip() {
    if (np && !skip.isPending && !skip.voted) skip.mutate(np.videoId);
  }

  const shortcuts = useShortcuts([
    { shortcuts: [Shortcut.AddSong], label: "Add a song", run: () => navigate({ to: "/search" }) },
    { shortcuts: [Shortcut.Skip], label: me.guest.isHost ? "Skip" : "Vote to skip", run: voteSkip },
  ]);
  const moments = useLiveMoments(me.guest.id);
  const react = useReact();
  const comment = useComment();
  const nudge = useNudge();
  useStillInTheJam();

  // The mini player shows once most of the now-playing card (the art, at
  // least) has scrolled up out of view, not only when all of it is gone.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardGone, setCardGone] = useState(false);
  const loaded = !!room;
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setCardGone(e.intersectionRatio < 0.4 && e.boundingClientRect.top < 0),
      { threshold: [0, 0.4] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loaded]);

  if (!room) return <Loader />;

  const queue = room.queue ?? [];
  const { upNext, autoplay } = splitQueue(queue);
  const { skipVotes } = room;
  const { skipVotesNeeded } = room.rules;
  const mine = myNudge(room.nudges, me.guest.id);
  const nowLeft = np && np.duration > 0 ? Math.max(0, np.duration - np.elapsed) : 0;
  const upNextLength = totalSeconds(upNext);
  const autoplayStartsIn = nowLeft + upNextLength;
  const votesToGo = skipVotesNeeded - skipVotes;

  const skipPill = np && (
    // Skip sits under the reactions: votes so far / needed, the full words for screen readers.
    <button
      type="button"
      className="btn-plain h-9 shrink-0 gap-1.5 px-3 text-[13px] tabular-nums"
      onClick={voteSkip}
      disabled={skip.isPending}
      aria-pressed={me.guest.isHost ? undefined : skip.voted}
      aria-keyshortcuts={ariaShortcut(Shortcut.Skip)}
      aria-label={
        me.guest.isHost
          ? "Skip"
          : `${skip.voted ? "Voted to skip" : "Vote to skip"}, ${skipVotes} of ${skipVotesNeeded}`
      }
      title={me.guest.isHost ? "Skip" : "Vote to skip"}
    >
      {skip.voted ? <Check className="size-4" /> : <SkipForward className="size-4" />}
      {me.guest.isHost ? "Skip" : `${skipVotes}/${skipVotesNeeded}`}
        </button>
  );

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
      {/* One slim line, so the song gets the room: name and who's here on the left, recap and leave on the right. */}
      <header className="flex h-12 items-center justify-between gap-3 px-4 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.015em]">{room.name}</h1>
          {/* Who's here sits with the room's name; the code lives on the join QR and /host. */}
          <WhosHere guests={room.guests ?? []} meId={me.guest.id} />
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[13px] t-2">
          <Link
            to="/recap"
            aria-label="Tonight’s recap"
            title="Tonight’s recap"
            className="-m-2 grid size-11 place-items-center hover:text-[var(--lg-ink)]"
          >
            <Sparkles className="size-4" aria-hidden />
          </Link>
          {me.guest.isHost ? (
            <Link to="/host" className="font-semibold text-[var(--lg-ink)]">
              Host
            </Link>
          ) : (
            <LeaveJam roomName={room.name} code={code} />
          )}
        </div>
      </header>

      {!room.player.connected && (
        <p
          role="status"
          className="mx-4 mb-4 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Can’t reach YouTube Music. Ask the host to open the app.
        </p>
      )}

      <section className="grid grid-cols-1 gap-3 px-4">
        <div ref={cardRef}>
          <LiveStage {...moments}>
            <NowPlayingCard song={np} saved={!!np && isSaved(np.videoId)} onSave={toggle} />
          </LiveStage>
        </div>
        <LiveControls
          showChat={false}
          lead={skipPill}
          feed={room.feed ?? []}
          meId={me.guest.id}
          onReact={(r) => react.mutate(r)}
          reactError={react.error?.message}
          sending={comment.isPending}
          commentError={comment.error?.message}
          onSend={(text, sent) => comment.mutate(text, { onSuccess: sent })}
          status={
            skip.voted && votesToGo > 0
              ? `You voted to skip. ${votesToGo === 1 ? "One more vote skips" : `${votesToGo} more votes skip`} this song.`
              : !me.guest.isHost
                ? (nudge.error?.message ??
                  (mine && `You asked for ${NUDGE_LOOKS[mine].asked}. Tap it again to take it back.`))
                : undefined
          }
          aside={
            // The host has the real volume control on /host.
            !me.guest.isHost && <VolumeNudges mine={mine} onNudge={(way) => nudge.mutate(way === mine ? null : way)} />
          }
        />
      </section>

      <section aria-labelledby="up-next" className="flex flex-1 flex-col px-4 pt-5 pb-32">
        <div className="flex items-center justify-between gap-3 pb-1">
          <h2 id="up-next" className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em]">
            Up next
          </h2>
          {upNext.length > 0 && (
            <div className="flex items-center gap-2.5">
              <p className="text-xs tabular-nums t-2">
                {upNext.length} {upNext.length === 1 ? "song" : "songs"}
                {upNextLength > 0 && ` · ${aboutMinutes(upNextLength)}`}
              </p>
              {upNext.length > 1 && <ShuffleButton className="size-9" />}
            </div>
          )}
        </div>
        {upNext.length === 0 ? (
          <EmptyQueue />
        ) : (
          <ReorderableQueue
            queue={upNext}
            meId={me.guest.id}
            canRemove={(item) => item.addedById === me.guest.id || me.guest.isHost}
            removingId={removeSong.isPending ? removeSong.variables : undefined}
            pendingMove={moveSong.isPending ? moveSong.variables : undefined}
            onRemove={(videoId) => removeSong.mutate(videoId)}
            onMove={(move) => moveSong.mutate(move)}
            nowLeft={nowLeft}
          />
        )}
        <div className="mt-6">
          <AutoplayList
            items={autoplay}
            startsIn={autoplayStartsIn}
            onRemove={me.guest.isHost ? (videoId) => removeSong.mutate(videoId) : undefined}
            removingId={removeSong.isPending ? removeSong.variables : undefined}
          />
        </div>
        <MadeWith className="mt-auto pt-10" />
      </section>

      {/* The dock floats over the list; the edge fades the rows out under it. */}
      <StickyMiniPlayer
        shown={cardGone}
        onTap={() => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
        action={skipPill}
      />
      <footer className="fixed inset-x-0 bottom-0 pb-[max(1.375rem,env(safe-area-inset-bottom))]">
        <div className="edge-bottom" />
        <nav aria-label="Song actions" className="relative mx-auto flex max-w-md gap-2.5 px-4">
          <Link
            to="/search"
            aria-keyshortcuts={ariaShortcut(Shortcut.AddSong)}
            className="glass-btn is-primary is-capsule h-[60px] flex-1 gap-2 text-[17px]"
          >
            <Plus className="size-5" strokeWidth={2.4} />
            <Mnemonic label="Add a song" shortcut={Shortcut.AddSong} />
          </Link>
          <ChatSheet
            feed={room.feed ?? []}
            meId={me.guest.id}
            sending={comment.isPending}
            error={comment.error?.message}
            onSend={(text, sent) => comment.mutate(text, { onSuccess: sent })}
          />
        </nav>
      </footer>
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
