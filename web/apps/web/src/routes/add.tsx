import { createFileRoute, redirect } from "@tanstack/react-router";

import { addSharedLink } from "@/hooks/use-queue";
import { requireGuest } from "@/hooks/use-session";
import { playlistIdFromUrl } from "@/lib/links";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// PWA share target (see vite.config.ts): "Share → Nimbrung" lands here with
// ?url= or ?text=. No screen; add the song, then show the queue. A shared
// playlist opens instead, to add from.
export const Route = createFileRoute("/add")({
  validateSearch: (s: Record<string, unknown>) => ({ url: str(s.url), text: str(s.text) }),
  beforeLoad: async ({ context, search }) => {
    // ponytail: a share from someone who hasn't joined yet is dropped at the
    // join screen; carry it through a ?next= param if that turns out common.
    await requireGuest(context.queryClient);
    // Android puts the link in `text` ("Check out … https://…"), not `url`.
    const link = search.url || search.text?.match(/https?:\/\/\S+/)?.[0];
    const playlistId = link && playlistIdFromUrl(link);
    if (playlistId) throw redirect({ to: "/playlist/$playlistId", params: { playlistId } });
    await addSharedLink(link);
    throw redirect({ to: "/" });
  },
});
