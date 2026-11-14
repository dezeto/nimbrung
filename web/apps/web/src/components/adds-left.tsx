import { useQuery } from "@tanstack/react-query";

import { isUnlimited } from "@/api/client";
import { meQuery } from "@/hooks/use-session";

/** "2 adds left this minute", for guests under the house rule; nothing for the host. */
export function AddsLeft() {
  // The rate limit is a sliding window, so adds come back on their own.
  const { data: me } = useQuery({ ...meQuery, refetchInterval: 10_000 });
  if (!me || isUnlimited(me.addsRemaining)) return null;
  const left = me.addsRemaining;
  return (
    <span
      role="status"
      className={left === 0 ? "text-[13px] t-mine" : "text-[13px] t-2"}
    >
      {left === 0
        ? "No adds left. Wait a minute"
        : `${left} ${left === 1 ? "add" : "adds"} left this minute`}
    </span>
  );
}
