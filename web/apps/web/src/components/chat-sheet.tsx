import { MessageCircle, X } from "lucide-react";
import { useRef, useState } from "react";

import { type FeedEntry, FeedKind } from "@/api/client";
import { ChatList } from "@/components/chat-list";
import { CommentBox } from "@/components/comment-box";

type Props = {
  feed: FeedEntry[];
  meId: string;
  sending: boolean;
  error?: string;
  onSend: (text: string, sent: () => void) => void;
};

/**
 * Chat as a round button in the Queue's dock that opens a bottom sheet, so
 * the page itself stays about the music. The badge counts comments that
 * arrived since the guest last closed the sheet (or opened the page).
 */
export function ChatSheet({ feed, meId, sending, error, onSend }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const comments = feed.filter((e) => e.kind === FeedKind.Comment).length;
  const [seen, setSeen] = useState(comments);
  const [open, setOpen] = useState(false);
  const unread = open ? 0 : Math.max(0, comments - seen);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Chat, ${unread} new` : "Chat"}
        className="glass-btn is-round is-lens glass-rim"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <MessageCircle className="size-6" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--nb-accent-fill)] px-1 text-[11px] font-bold text-white tabular-nums"
          >
            {unread}
          </span>
        )}
      </button>
      <dialog
        ref={dialog}
        aria-label="Chat"
        className="sheet chat-sheet glass-modal"
        onClose={() => {
          setOpen(false);
          setSeen(comments);
        }}
        // A tap on the dimmed page around the sheet closes it.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div className="flex h-full flex-col">
          <header className="relative grid h-14 shrink-0 place-items-center px-14">
            <h2 className="text-[17px] font-semibold">Chat</h2>
            <button type="button" className="chat-close absolute right-4" aria-label="Close chat" onClick={close}>
              <X className="size-4" strokeWidth={2.6} />
            </button>
          </header>
          <ChatList feed={feed} meId={meId} className="max-h-none min-h-0 flex-1 px-3" />
          <div className="shrink-0 px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
            {open && <CommentBox sending={sending} error={error} onSend={onSend} autoFocus />}
          </div>
        </div>
      </dialog>
    </>
  );
}
