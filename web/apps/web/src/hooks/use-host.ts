import { type QueryClient, useMutation } from "@tanstack/react-query";

import { ApiError, api } from "@/api/client";
import { meQuery, roomInfoQuery } from "@/hooks/use-session";

// The host key arrives once in the Host link (?key=…). We keep it so the host
// can reopen /host without the link. Storage can throw (private mode), and
// losing the key only means pasting the link again.
const STORAGE_KEY = "nimbrung.hostKey";

export function rememberHostKey(key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {}
}

function storedHostKey() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function forgetHostKey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export enum HostStatus {
  Ok = "ok",
  NoKey = "no-key",
  BadKey = "bad-key",
}

/** Makes this browser the host with the remembered key, or says why it can't. */
export async function becomeHost(queryClient: QueryClient): Promise<HostStatus> {
  const me = await queryClient.ensureQueryData(meQuery).catch(() => null);
  if (me?.guest.isHost) return HostStatus.Ok;

  const key = storedHostKey();
  if (!key) return HostStatus.NoKey;

  // Off the host's computer the code is "" until this joins; the key is enough.
  const room = await queryClient.ensureQueryData(roomInfoQuery);
  try {
    await api.join({ code: room.code, name: "Host", hostKey: key });
  } catch (err) {
    // The server makes a new key on every start, so an old one is normal.
    if (err instanceof ApiError && err.status === 403) {
      forgetHostKey();
      return HostStatus.BadKey;
    }
    throw err;
  }
  await Promise.all([
    queryClient.fetchQuery(meQuery),
    queryClient.invalidateQueries({ queryKey: roomInfoQuery.queryKey }),
  ]);
  return HostStatus.Ok;
}

export function usePlayPause() {
  return useMutation({ mutationFn: (play: boolean) => (play ? api.play() : api.pause()) });
}

// A tapped lyric line jumps the song there.
export function useSeek() {
  return useMutation({ mutationFn: (seconds: number) => api.seek(seconds) });
}

// Volume errors show next to the control, not as a toast. One scope runs
// the levels one after another, so quick key presses can't land out of order.
export function useSetVolume() {
  return useMutation({
    mutationFn: api.setVolume,
    scope: { id: "volume" },
    meta: { inlineError: true },
  });
}

export function useSetMuted() {
  return useMutation({ mutationFn: api.setMuted, meta: { inlineError: true } });
}

export function useSetRules() {
  return useMutation({ mutationFn: api.setRules });
}

/** Removing a guest; `block` also keeps their network from joining again. */
export type Kick = { guestId: string; block: boolean };

export function useKickGuest() {
  return useMutation({
    mutationFn: ({ guestId, block }: Kick) =>
      block ? api.blockGuest(guestId) : api.kickGuest(guestId),
    meta: { inlineError: true }, // shown under the guest's row
  });
}

/** Who and what a reset clears: everyone but this device, and Up next. */
export type Reset = { guestIds: string[]; videoIds: string[] };

/** Starts the jam over: only this device stays, Up next empties. */
export function useResetJam() {
  return useMutation({
    mutationFn: async ({ guestIds, videoIds }: Reset) => {
      await Promise.all(guestIds.map(api.kickGuest));
      // One at a time: the server finds each song's index fresh, and the
      // queue shifts after every removal.
      for (const id of videoIds) await api.removeSong(id);
    },
    meta: { inlineError: true }, // shown under the button
  });
}

export function useLetIn() {
  return useMutation({ mutationFn: api.letIn, meta: { inlineError: true } });
}

export function useUnblock() {
  return useMutation({ mutationFn: api.unblock, meta: { inlineError: true } });
}
