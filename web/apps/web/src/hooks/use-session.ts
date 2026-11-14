import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { api, isKicked } from "@/api/client";
import { QueryKey } from "@/hooks/query-keys";
import { useRoomState } from "@/hooks/use-room-state";

/** Who this browser is; fails with a 401 ApiError until the guest has joined. */
export const meQuery = queryOptions({ queryKey: [QueryKey.Me], queryFn: api.me, retry: false });

/** Public room info (name, guests). Used before joining, so no cookie needed; the code comes only after. */
export const roomInfoQuery = queryOptions({ queryKey: [QueryKey.Room], queryFn: api.room });

/** The join screen's code when the server won't tell it: the visitor types it. */
export const NO_CODE = "-";

/**
 * Route guard: resolves the guest, or redirects to the join screen when this
 * browser hasn't joined (or the server restarted and forgot it), to /waiting
 * while the host hasn't let them in, or to /removed when the host removed them.
 */
export async function requireGuest(queryClient: QueryClient) {
  let me;
  try {
    me = await queryClient.ensureQueryData(meQuery);
  } catch (err) {
    if (isKicked(err)) throw redirect({ to: "/removed", replace: true });
    const room = await queryClient.ensureQueryData(roomInfoQuery);
    throw redirect({ to: "/join/$code", params: { code: room.code || NO_CODE } });
  }
  if (me.waiting) throw redirect({ to: "/waiting", replace: true });
  return me;
}

export function useJoin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.join,
    meta: { inlineError: true }, // shown under the join button
    // The cookie changed, so whatever "me" we cached (usually a 401) is stale,
    // and the room info now carries the code.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: roomInfoQuery.queryKey }),
      ]),
  });
}

/** Leaves the jam: the server forgets this guest (their songs stay queued), then back to the join screen. */
export function useLeave(code: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: api.leave,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: meQuery.queryKey });
      navigate({ to: "/join/$code", params: { code: code || NO_CODE }, replace: true });
    },
  });
}

/**
 * Sends this browser to /removed once the host removes its guest. Nothing is
 * pushed to just one guest: the snapshot simply stops listing them, so ask
 * /api/me why. Removed answers 410; a restart (401) or a snapshot from before
 * joining (200) leaves the screen as it is.
 */
export function useStillInTheJam() {
  const { data: me, refetch } = useQuery(meQuery);
  const room = useRoomState();
  const navigate = useNavigate();
  const missing = !!me && !!room && !room.guests?.some((g) => g.id === me.guest.id);
  const askWhy = useEffectEvent(async () => {
    const { error } = await refetch();
    if (isKicked(error)) navigate({ to: "/removed", replace: true });
  });
  // On the boolean, not the guest list: once per going missing, not on every
  // 1-second snapshot (which after a restart would poll /api/me forever).
  useEffect(() => {
    if (missing) askWhy();
  }, [missing]);
}
