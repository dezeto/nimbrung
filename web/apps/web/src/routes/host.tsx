import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  Copy,
  KeyRound,
  ListMusic,
  MonitorPlay,
  Pause,
  Play,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";

import { AutoplayList } from "@/components/autoplay-list";
import { AutoplayMark } from "@/components/autoplay-mark";
import { BlockedList } from "@/components/blocked-list";
import { EmptyQueue } from "@/components/empty-queue";
import { GuestList } from "@/components/guest-list";
import { LiveControls } from "@/components/live-controls";
import { LiveStage } from "@/components/live-stage";
import Loader from "@/components/loader";
import { QrCode } from "@/components/qr-code";
import { ReorderableQueue } from "@/components/reorderable-queue";
import { RulesForm } from "@/components/rules-form";
import { ShortcutHelp } from "@/components/shortcut-help";
import { ShuffleButton } from "@/components/shuffle-button";
import { VolumeControl } from "@/components/volume-control";
import {
  HostStatus,
  becomeHost,
  rememberHostKey,
  useKickGuest,
  useLetIn,
  useResetJam,
  usePlayPause,
  useSetMuted,
  useSetRules,
  useSetVolume,
  useUnblock,
} from "@/hooks/use-host";
import { useComment, useLiveMoments, useReact } from "@/hooks/use-live";
import { useMoveSong, useRemoveSong, useVoteSkip } from "@/hooks/use-queue";
import { useRoomState } from "@/hooks/use-room-state";
import { meQuery, roomInfoQuery, useStillInTheJam } from "@/hooks/use-session";
import { Shortcut, ariaShortcut, useShortcuts } from "@/hooks/use-shortcuts";
import { inviteUrl } from "@/lib/links";
import { aboutMinutes, splitQueue, totalSeconds } from "@/lib/queue";
import { formatDuration } from "@/lib/time";
import { who } from "@/lib/who";

export const Route = createFileRoute("/host")({
  validateSearch: (s: Record<string, unknown>): { key?: string } =>
    typeof s.key === "string" ? { key: s.key } : {},
  // Take the key out of the address bar right away so it isn't shared or
  // left in history; it's remembered locally instead.
  beforeLoad: ({ search }) => {
    if (search.key) {
      rememberHostKey(search.key);
      throw redirect({ to: "/host", search: {}, replace: true });
    }
  },
  loader: ({ context }) => becomeHost(context.queryClient),
  component: HostScreen,
});

function HostScreen() {
  const status = Route.useLoaderData();
  return status === HostStatus.Ok ? <HostDashboard /> : <NotHost status={status} />;
}

function NotHost({ status }: { status: Exclude<HostStatus, HostStatus.Ok> }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 px-4">
      <KeyRound className="size-6 text-[var(--nb-accent)]" />
      <h1 className="text-xl font-semibold">
        {status === HostStatus.BadKey ? "That host link is out of date" : "Host link needed"}
      </h1>
      <p className="text-sm t-2">
        {status === HostStatus.BadKey
          ? "The server makes a new host key every time it starts. Open the latest Host link printed in the terminal."
          : "Open the Host link printed in the terminal when you started Nimbrung (it ends in ?key=…)."}
      </p>
    </main>
  );
}

function HostDashboard() {
  const { data: me } = useSuspenseQuery(meQuery);
  // Polled: if the laptop changes Wi-Fi, the QR code follows the new address.
  const { data: info } = useSuspenseQuery({ ...roomInfoQuery, refetchInterval: 15_000 });
  const room = useRoomState();
  const removeSong = useRemoveSong();
  const moveSong = useMoveSong();
  const skip = useVoteSkip(room?.nowPlaying?.videoId, room?.skipVotes ?? 0);
  const playPause = usePlayPause();
  const setRules = useSetRules();
  const navigate = useNavigate();
  const moments = useLiveMoments(me.guest.id);
  const react = useReact();
  const comment = useComment();
  const kickGuest = useKickGuest();
  const resetJam = useResetJam();
  const unblock = useUnblock();
  const letIn = useLetIn();
  const setVolume = useSetVolume();
  const setMuted = useSetMuted();
  useStillInTheJam();

  const invite = inviteUrl(info);
  const np = room?.nowPlaying ?? null;

  function togglePlay() {
    if (np && !playPause.isPending) playPause.mutate(np.isPaused);
  }

  function skipNow() {
    if (np && !skip.isPending) skip.mutate(np.videoId);
  }

  function toggleMute() {
    if (room && !setMuted.isPending) setMuted.mutate(!room.volume.muted);
  }

  function copyInvite() {
    navigator.clipboard
      .writeText(invite)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn’t copy. Select the link instead"));
  }

  const shortcuts = useShortcuts([
    { shortcuts: [Shortcut.PlayPause], label: "Play / pause", run: togglePlay },
    { shortcuts: [Shortcut.Skip], label: "Skip", run: skipNow },
    { shortcuts: [Shortcut.Mute], label: "Mute / unmute", run: toggleMute },
    { shortcuts: [Shortcut.CopyInvite], label: "Copy invite link", run: copyInvite },
    { shortcuts: [Shortcut.AddSong], label: "Add a song", run: () => navigate({ to: "/search" }) },
    { shortcuts: [Shortcut.Queue], label: "Queue (guest view)", run: () => navigate({ to: "/" }) },
  ]);

  if (!room) return <Loader />;

  const queue = room.queue ?? [];
  const { upNext, autoplay } = splitQueue(queue);
  const nowLeft = np && np.duration > 0 ? Math.max(0, np.duration - np.elapsed) : 0;
  const guests = room.guests ?? [];
  const reset = {
    guestIds: guests.filter((g) => g.id !== me.guest.id).map((g) => g.id),
    videoIds: upNext.map((item) => item.videoId),
  };
  const waiting = room.waiting ?? [];
  const feed = room.feed ?? [];
  const kicking = kickGuest.isPending ? kickGuest.variables : undefined;
  const kickFailed = kickGuest.isError
    ? { guestId: kickGuest.variables.guestId, error: kickGuest.error.message }
    : undefined;
  const elapsed = np ? (np.duration > 0 ? Math.min(np.elapsed, np.duration) : np.elapsed) : 0;
  const removingId = removeSong.isPending ? removeSong.variables : undefined;

  // Flat round icon buttons, same look as the "?" shortcut hint.
  const iconAction =
    "icon-btn bg-[rgb(var(--nb-fg)/0.08)] shadow-[inset_0_0_0_1px_rgb(var(--nb-fg)/0.14)] hover:text-[var(--lg-ink)]";
  const viewActions = (
    <>
      <Link
        to="/"
        className={iconAction}
        aria-label="Queue"
        title="Queue"
        aria-keyshortcuts={ariaShortcut(Shortcut.Queue)}
      >
        <ListMusic className="size-5" />
      </Link>
      <Link to="/room" className={iconAction} aria-label="Room view" title="Room view">
        <MonitorPlay className="size-5" />
      </Link>
      <button
        type="button"
        onClick={copyInvite}
        aria-keyshortcuts={ariaShortcut(Shortcut.CopyInvite)}
        aria-label="Copy invite"
        title="Copy invite"
        className={iconAction}
      >
        <Copy className="size-5" />
      </button>
    </>
  );

  return (
    <div className="min-h-svh">
      <header aria-label="Player" className="glass-toolbar sticky top-0 z-20">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-3 py-2 lg:flex-wrap lg:gap-x-[18px] lg:gap-y-3 lg:px-6 lg:py-3">
          <div role="group" aria-label="Playback" className="flex shrink-0 items-center gap-1 lg:gap-1.5">
            <button
              type="button"
              className="btn-plain size-11 p-0 lg:size-12"
              disabled={!np || playPause.isPending}
              onClick={togglePlay}
              aria-label={np?.isPaused ? "Play" : "Pause"}
              aria-keyshortcuts={ariaShortcut(Shortcut.PlayPause)}
            >
              {np?.isPaused ? <Play className="size-5" /> : <Pause className="size-5" />}
            </button>
            <button
              type="button"
              className="btn-plain is-ghost size-11 p-0"
              disabled={!np || skip.isPending}
              onClick={skipNow}
              aria-label="Skip"
              aria-keyshortcuts={ariaShortcut(Shortcut.Skip)}
            >
              <SkipForward className="size-5" />
            </button>
          </div>

          <div
            aria-label="Now playing"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-[rgb(var(--nb-fg)/0.06)] py-1 pr-2.5 pl-1 shadow-[inset_0_0_0_1px_rgb(var(--nb-fg)/0.1)] lg:flex-[1_1_380px] lg:gap-3 lg:py-1.5 lg:pr-3.5 lg:pl-1.5"
          >
            <div className="thumb size-10 lg:size-12">
              {np?.thumb && <img src={np.thumb} alt="" className="size-full object-cover" />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="truncate text-sm font-semibold">
                  {np ? (
                    <>
                      {np.title} <span className="font-medium t-2">· {np.artist}</span>
                    </>
                  ) : (
                    <span className="t-2">Nothing playing</span>
                  )}
                </span>
                {np && (
                  <span className="shrink-0 text-xs t-2 max-sm:hidden">
                    {np.addedBy ? `Added by ${who(np.addedBy, np.addedByAvatar)}` : <AutoplayMark labelled />}
                  </span>
                )}
              </p>
              {np && np.duration > 0 && (
                <div className="flex items-center gap-2.5 text-xs font-semibold tabular-nums t-2">
                  <span className="max-sm:hidden">{formatDuration(elapsed)}</span>
                  <div
                    className="progress h-1 flex-1"
                    role="progressbar"
                    aria-label="Song progress"
                    aria-valuemin={0}
                    aria-valuemax={np.duration}
                    aria-valuenow={Math.round(elapsed)}
                  >
                    <i style={{ width: `${(elapsed / np.duration) * 100}%` }} />
                  </div>
                  <span className="max-sm:hidden">{formatDuration(np.duration)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Narrow: just the mute icon here; the slider sits in the strip below the header. */}
          <button
            type="button"
            className="icon-btn text-[var(--lg-ink)] lg:hidden"
            onClick={toggleMute}
            aria-pressed={room.volume.muted}
            aria-label={room.volume.muted ? "Unmute" : "Mute"}
            aria-keyshortcuts={ariaShortcut(Shortcut.Mute)}
          >
            {room.volume.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <div className="hidden min-w-[220px] flex-[0_1_300px] lg:block">
            <VolumeControl
              volume={room.volume}
              nudges={room.nudges}
              onSetLevel={(level, failed) => setVolume.mutate(level, { onError: failed })}
              onToggleMute={toggleMute}
              error={(setVolume.error ?? setMuted.error)?.message}
            />
          </div>

          <nav aria-label="Views" className="hidden items-center gap-2 lg:flex">
            {viewActions}
          </nav>
        </div>
      </header>

      {/* Narrow: the secondary actions and volume slider, kept out of the sticky bar. */}
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 pt-3 md:flex-row md:items-center md:justify-between lg:hidden">
        <nav aria-label="Views" className="flex items-center gap-2">
          {viewActions}
        </nav>
        <div className="md:w-80 [&_.icon-btn]:hidden">
          <VolumeControl
            volume={room.volume}
            nudges={room.nudges}
            onSetLevel={(level, failed) => setVolume.mutate(level, { onError: failed })}
            onToggleMute={toggleMute}
            error={(setVolume.error ?? setMuted.error)?.message}
          />
        </div>
      </div>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 pt-4 empty:hidden">
        {!room.player.connected && (
          <p role="status" className="glass-card px-4 py-3 text-sm t-mine">
            Can’t reach YouTube Music: {room.player.error ?? "is the app running?"}
          </p>
        )}
        {waiting.length > 0 && (
          <section aria-label="Waiting to join" className="glass-card glass-rim grid gap-2 px-4 py-3">
            <h2 className="text-[15px] font-semibold">
              Waiting to join · <span className="tabular-nums">{waiting.length}</span>
            </h2>
            <GuestList
              guests={waiting}
              meId={me.guest.id}
              kicking={kicking}
              failed={kickFailed}
              onKick={(kick) => kickGuest.mutate(kick)}
              waitlist={{
                lettingInId: letIn.isPending ? letIn.variables : undefined,
                onLetIn: (guestId) => letIn.mutate(guestId),
              }}
            />
            {letIn.error && (
              <p role="alert" className="first-letter:uppercase text-xs t-mine">
                {letIn.error.message}
              </p>
            )}
          </section>
        )}
      </div>

      {/* Narrow: the sidebar card dissolves (contents) so its sections sit flat in one column,
          ordered Up next, Autoplay, Chat, In the jam, House rules, Invite. */}
      <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 pt-4 pb-16 lg:flex-row lg:flex-wrap lg:items-start lg:gap-0 lg:p-0">
        <aside
          aria-label="Sections"
          className="glass-card m-4 flex-col gap-[18px] px-3.5 py-[18px] max-lg:contents lg:mr-0 lg:flex lg:max-w-[360px] lg:min-w-0 lg:flex-[1_1_300px]"
          style={{ borderRadius: 28 }}
        >
          <div className="flex flex-col gap-[18px] max-lg:order-4">
          <div className="min-w-0 px-1.5">
            <h1 className="truncate text-[15px] font-semibold">{room.name}</h1>
            <p className="text-xs t-2">
              Hosting ·{" "}
              <Link to="/recap" className="underline underline-offset-4 hover:text-[var(--lg-ink)]">
                Tonight’s recap
              </Link>
            </p>
          </div>
          <div className="flex flex-col items-center gap-2.5 rounded-[20px] bg-[rgb(0_0_0/0.22)] px-3 pt-4 pb-3.5">
            <p className="text-xs font-semibold t-2">Scan to join</p>
            <QrCode value={invite} className="size-[168px] rounded-2xl" />
            <p
              translate="no"
              className="-mr-[0.3em] font-mono text-[26px] leading-8 font-semibold tracking-[0.3em]"
            >
              {info.code}
            </p>
            <button
              type="button"
              onClick={copyInvite}
              className="flex max-w-full items-center gap-1.5 text-xs t-2 hover:text-[var(--lg-ink)]"
            >
              <span className="truncate">{invite.replace(/^https?:\/\//, "")}</span>
              <Copy className="size-3.5 shrink-0" aria-hidden />
            </button>
          </div>
          </div>
      <section
        id="in-the-jam"
        aria-labelledby="in-the-jam-h"
        className="min-w-0 scroll-mt-28 max-lg:order-2"
      >
        <h2 id="in-the-jam-h" className="px-1.5 pb-2 text-[15px] font-semibold">
          In the jam · <span className="tabular-nums">{guests.length}</span>
        </h2>
        <GuestList
          guests={guests}
          meId={me.guest.id}
          kicking={kicking}
          failed={kickFailed}
          onKick={(kick) => kickGuest.mutate(kick)}
        />
        {(reset.guestIds.length > 0 || reset.videoIds.length > 0) && (
          <div className="px-1.5 pt-2">
            <button
              type="button"
              disabled={resetJam.isPending}
              onClick={() => {
                // ponytail: native confirm, packages/ui has no dialog
                if (
                  confirm(
                    `Reset the jam? Removes ${reset.guestIds.length} people (other host devices too) and ${reset.videoIds.length} songs from Up next. This device stays host.`,
                  )
                )
                  resetJam.mutate(reset);
              }}
              className="text-xs t-2 underline underline-offset-4 hover:text-[var(--lg-ink)] disabled:opacity-50"
            >
              {resetJam.isPending ? "Resetting…" : "Reset the jam"}
            </button>
            {resetJam.error && (
              <p role="alert" className="first-letter:uppercase pt-1 text-xs t-mine">
                {resetJam.error.message}
              </p>
            )}
          </div>
        )}
        <BlockedList
          blocked={room.blocked ?? []}
          unblockingId={unblock.isPending ? unblock.variables : undefined}
          error={unblock.error?.message}
          onUnblock={(id) => unblock.mutate(id)}
        />
      </section>
      <section id="rules" aria-labelledby="rules-h" className="min-w-0 scroll-mt-28 max-lg:order-3">
        <h2 id="rules-h" className="px-1.5 pb-2 text-[15px] font-semibold">
          House rules
        </h2>
        <div className="section px-3.5 py-3.5">
          <RulesForm
            rules={room.rules}
            saving={setRules.isPending}
            onSave={(rules) => setRules.mutate(rules)}
          />
        </div>
      </section>
        </aside>

        <main className="order-1 flex min-w-0 flex-col gap-9 lg:order-none lg:flex-[999_1_600px] lg:px-7 lg:pt-7 lg:pb-16">
          <LiveStage {...moments}>
            <section id="up-next" aria-labelledby="up-next-h" className="scroll-mt-28">
              <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
                <h2 id="up-next-h" className="text-[28px] leading-[34px] font-bold tracking-[-0.025em]">
                  Up next
                </h2>
                {upNext.length > 0 && (
                  <div className="flex items-center gap-3">
                    <p className="text-sm tabular-nums t-2">
                      {upNext.length} {upNext.length === 1 ? "song" : "songs"} ·{" "}
                      {aboutMinutes(totalSeconds(upNext))}
                    </p>
                    {upNext.length > 1 && <ShuffleButton className="size-10" />}
                  </div>
                )}
              </div>
              {upNext.length === 0 ? (
                <div className="max-lg:[&>div]:mt-0 max-lg:[&>div]:gap-2 max-lg:[&>div]:py-4 max-lg:[&>div>svg]:hidden">
                  <EmptyQueue />
                </div>
              ) : (
                <ReorderableQueue
                  queue={upNext}
                  meId={me.guest.id}
                  canRemove={() => true}
                  removingId={removingId}
                  pendingMove={moveSong.isPending ? moveSong.variables : undefined}
                  onRemove={(videoId) => removeSong.mutate(videoId)}
                  onMove={(move) => moveSong.mutate(move)}
                  nowLeft={nowLeft}
                />
              )}
            </section>
          </LiveStage>

          <div className="flex flex-col gap-9 lg:flex-row lg:flex-wrap lg:gap-x-10">
            <div className="min-w-0 lg:flex-[1_1_320px]">
              <AutoplayList
                items={autoplay}
                startsIn={nowLeft + totalSeconds(upNext)}
                onRemove={(videoId) => removeSong.mutate(videoId)}
                removingId={removingId}
              />
              {autoplay.length === 0 && (
                <p className="px-1 text-sm t-2">No autoplay rows queued.</p>
              )}
            </div>
            <section id="chat" aria-labelledby="chat-h" className="min-w-0 scroll-mt-28 lg:flex-[1_1_320px]">
              <h2 id="chat-h" className="px-1 pb-2 text-[22px] leading-7 font-bold tracking-[-0.02em]">
                Chat
              </h2>
              <LiveControls
                feed={feed}
                meId={me.guest.id}
                onReact={(r) => react.mutate(r)}
                reactError={react.error?.message}
                sending={comment.isPending}
                commentError={comment.error?.message}
                onSend={(text, sent) => comment.mutate(text, { onSuccess: sent })}
              />
            </section>
          </div>

        </main>
      </div>
      <ShortcutHelp {...shortcuts} />
    </div>
  );
}
