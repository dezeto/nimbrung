import { useQuery } from "@tanstack/react-query";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { Hourglass } from "lucide-react";

import { isKicked } from "@/api/client";
import { meQuery, roomInfoQuery } from "@/hooks/use-session";
import { MadeWith } from "@/components/made-with";

export const Route = createFileRoute("/waiting")({ component: WaitingScreen });

// How often to ask whether the host let this browser in. Nothing is pushed to
// just one guest, so ask, like useStillInTheJam does.
const ASK_EVERY_MS = 2000;

function WaitingScreen() {
  const { data: me, error } = useQuery({ ...meQuery, refetchInterval: ASK_EVERY_MS });
  const { data: room } = useQuery(roomInfoQuery);

  if (isKicked(error)) return <Navigate to="/removed" replace />;
  // Let in, or never joined / the server restarted: "/" sorts out which.
  if ((me && !me.waiting) || error) return <Navigate to="/" replace />;

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 px-4">
      <Hourglass className="size-6 text-primary" />
      <h1 className="text-xl font-semibold">Waiting for the host</h1>
      <p role="status" className="text-sm text-muted-foreground">
        You’ll be in {room?.name ?? "the jam"} as soon as the host lets you in. Keep this page
        open.
      </p>
      <MadeWith className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] px-4" />
    </main>
  );
}
