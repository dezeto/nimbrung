import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { UserMinus } from "lucide-react";

import { meQuery, roomInfoQuery } from "@/hooks/use-session";

// No guard: this browser's cookie now answers 410 to every guest call, so the
// screen asks nothing but the room's public name.
export const Route = createFileRoute("/removed")({
  // Forget who this browser was, so Back or the QR code lands on the join form
  // instead of the jam from the cache.
  onEnter: ({ context }) => context.queryClient.removeQueries({ queryKey: meQuery.queryKey }),
  component: RemovedScreen,
});

function RemovedScreen() {
  const { data: room } = useQuery(roomInfoQuery);
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 px-4">
      <UserMinus className="size-6 text-primary" />
      <h1 className="text-xl font-semibold">The host removed you</h1>
      <p className="text-sm text-muted-foreground">
        You’re no longer in {room?.name ?? "the jam"}.
      </p>
    </main>
  );
}
