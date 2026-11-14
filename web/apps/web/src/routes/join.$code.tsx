import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { useRoomState } from "@/hooks/use-room-state";
import { NO_CODE, meQuery, roomInfoQuery, useJoin } from "@/hooks/use-session";

export const Route = createFileRoute("/join/$code")({
  // Already in (e.g. scanned the QR again) → straight to the queue.
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery).catch(() => null);
    if (me) throw redirect({ to: "/" });
  },
  component: JoinScreen,
});

function JoinScreen() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const { data: room } = useQuery(roomInfoQuery);
  // The room's stream is public (it's what the Room view shows), so the
  // invite can show what's playing before you join.
  const np = useRoomState()?.nowPlaying;
  const join = useJoin();
  const known = params.code !== NO_CODE;
  const [code, setCode] = useState(known ? params.code.toUpperCase() : "");
  // The link already carries the code; the field only opens to change it,
  // or when someone came without it.
  const [editCode, setEditCode] = useState(!known);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const taken = new Set(room?.avatars.taken);
  const faces = room?.avatars.all ?? [];
  // Your pick while it's free, else the first free face (someone may take yours meanwhile).
  const [picked, setPicked] = useState<string>();
  const avatar = picked && !taken.has(picked) ? picked : faces.find((f) => !taken.has(f));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    join.mutate(
      { code, name, avatar },
      {
        onSuccess: () => navigate({ to: "/" }),
        // Most likely someone just took that face: show which are gone now.
        onError: () => queryClient.invalidateQueries({ queryKey: roomInfoQuery.queryKey }),
      },
    );
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col items-center gap-5 text-center">
        {np?.thumb && (
          <figure className="flex flex-col items-center gap-3">
            <span className="block size-[min(56vw,220px)] overflow-hidden rounded-[22px] shadow-[0_28px_60px_-20px_rgb(0_0_0/0.75)]">
              <img src={np.thumb} alt="" className="size-full object-cover" />
            </span>
            <figcaption className="max-w-full text-[13px] t-2">
              <span className="sr-only">Now playing: </span>
              <span className="font-semibold text-[var(--lg-ink)]">{np.title}</span> · {np.artist}
            </figcaption>
          </figure>
        )}
        <div className="grid gap-1">
          <p className="text-[15px] t-2">You’re invited to</p>
          <h1 className="text-[34px] leading-[40px] font-bold tracking-[-0.025em] break-words text-balance">
            {room?.name ?? "the jam"}
          </h1>
          {!!room?.guests && (
            <p className="text-[13px] t-2">
              {room.guests} {room.guests === 1 ? "person is" : "people are"} in
            </p>
          )}
        </div>
      </header>

      <form onSubmit={onSubmit} className="grid gap-3">
        {faces.length > 0 && (
          <fieldset className="mb-2 grid gap-2.5">
            <legend className="mb-2.5 px-1 text-[13px] font-semibold t-2">Pick your face</legend>
            <div className="grid grid-cols-6 gap-2">
              {faces.map((face) => (
                <label
                  key={face}
                  className="grid h-[50px] cursor-pointer place-items-center rounded-2xl bg-[rgb(var(--nb-fg)/0.08)] text-[26px] shadow-[inset_0_0_0_1px_transparent] transition-[background-color,box-shadow,opacity] has-checked:bg-[rgb(var(--nb-fg)/0.16)] has-checked:shadow-[inset_0_0_0_2px_rgb(var(--nb-fg)/0.85)] has-disabled:cursor-not-allowed has-disabled:opacity-30 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--lg-ink)]"
                >
                  <input
                    type="radio"
                    name="avatar"
                    value={face}
                    checked={face === avatar}
                    disabled={taken.has(face)}
                    onChange={() => setPicked(face)}
                    className="sr-only"
                  />
                  <span aria-hidden>{face}</span>
                  <span className="sr-only">{taken.has(face) ? `${face} (taken)` : face}</span>
                </label>
              ))}
            </div>
            <p className="px-1 text-xs t-2">Two people can’t have the same one.</p>
          </fieldset>
        )}
        <label htmlFor="name" className="sr-only">
          Your name
        </label>
        <div className="glass-field h-14">
          <input
            id="name"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="nickname"
            spellCheck={false}
            // A phone's keyboard would cover the invite; only jump in with a mouse.
            autoFocus={matchMedia("(pointer: fine)").matches}
            className="text-[17px]"
          />
        </div>
        {editCode && (
          <>
            <label htmlFor="code" className="sr-only">
              Room code
            </label>
            <div className="glass-field h-14">
              <input
                id="code"
                name="code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                translate="no"
                autoFocus
                className="font-mono text-[17px] tracking-[0.3em]"
              />
            </div>
          </>
        )}
        <button
          type="submit"
          disabled={join.isPending}
          className="glass-btn is-primary is-capsule h-14 text-[17px]"
        >
          {join.isPending ? "Joining…" : "Join the jam"}
        </button>
        {join.isError && (
          <p role="alert" className="first-letter:uppercase text-center text-sm t-mine">
            {join.error.message}
          </p>
        )}
        {!editCode && (
          <p className="text-center text-[13px] t-2">
            Code{" "}
            <span translate="no" className="font-mono font-semibold tracking-[0.15em] text-[var(--lg-ink)]">
              {code}
            </span>{" "}
            ·{" "}
            <button type="button" onClick={() => setEditCode(true)} className="min-h-9 underline underline-offset-4">
              Different code?
            </button>
          </p>
        )}
      </form>

      <p className="text-center text-xs t-2">No account, no app. Just pick songs.</p>
    </main>
  );
}
