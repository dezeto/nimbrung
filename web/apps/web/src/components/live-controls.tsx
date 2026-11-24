import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { type FeedEntry, FeedKind, type Reaction } from "@/api/client";
import { ChatList } from "@/components/chat-list";
import { CommentBox } from "@/components/comment-box";
import { ReactionBar } from "@/components/reaction-bar";

type Props = {
  feed: FeedEntry[];
  meId: string;
  onReact: (reaction: Reaction) => void;
  reactError?: string;
  sending: boolean;
  commentError?: string;
  onSend: (text: string, sent: () => void) => void;
  /** Starts the row, left of the reactions button (Skip / Vote to skip). */
  lead?: ReactNode;
  /** Sits just left of the reactions button (the Saved toggle). */
  beforeReactions?: ReactNode;
  /** Ends the row, right of the reactions button (the guest's Quieter | Louder). */
  aside?: ReactNode;
  /** One quiet line under the row: a standing skip vote or volume ask. */
  status?: string | false;
  /** False when the chat lives elsewhere (the Queue's chat sheet). */
  showChat?: boolean;
};

/**
 * Reactions and the chat, kept quiet so the music stays the focus: one row
 * of Skip, the reactions button and volume, the comment box, then the latest comment on one line.
 * Tapping that line opens the history.
 */
export function LiveControls({
  feed,
  meId,
  onReact,
  reactError,
  sending,
  commentError,
  onSend,
  lead,
  beforeReactions,
  aside,
  status,
  showChat = true,
}: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const chatId = useId();
  const comments = feed.filter((e) => e.kind === FeedKind.Comment);
  const latest = comments.at(-1);
  const latestName = latest && (latest.guestId === meId ? "You" : latest.name);

  return (
    <section className="grid gap-1.5">
      {/* One row: Skip on the left; reactions beside volume on the right. The
          right group anchors the reactions tray, so it stays on screen. */}
      <div className="flex items-center justify-between gap-2">
        {lead ?? <span />}
        <div className="relative flex items-center gap-2">
          {beforeReactions}
          <ReactionBar onReact={onReact} />
          {aside}
        </div>
      </div>
      {status && (
        <p role="status" className="first-letter:uppercase px-1 text-xs t-2">
          {status}
        </p>
      )}
      {/* A rate limit is a nudge, not an error: keep it quiet. */}
      {reactError && (
        <p role="status" className="first-letter:uppercase text-xs t-2">
          {reactError}
        </p>
      )}
      {showChat && (
        <>
      {/* The box is always there, so chatting is one tap; the latest line under it opens the history. */}
      <CommentBox sending={sending} error={commentError} onSend={onSend} />
      {latest && (
        <button
          type="button"
          className="flex min-h-9 items-center gap-1.5 px-1 text-left text-[13px]"
          aria-expanded={chatOpen}
          aria-controls={chatId}
          onClick={() => setChatOpen(!chatOpen)}
        >
          <span className="min-w-0 flex-1 truncate">
            <b className="font-semibold">{latestName}</b> <span className="t-2">{latest.text}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums t-2">
            {comments.length}
            {chatOpen ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </span>
        </button>
      )}
      {chatOpen && (
        <div id={chatId}>
          <ChatList feed={feed} meId={meId} />
        </div>
      )}
        </>
      )}
    </section>
  );
}
