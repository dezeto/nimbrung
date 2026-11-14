import { cn } from "@web/ui/lib/utils";
import { ArrowUp } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { MAX_COMMENT_LENGTH, commentLength } from "@/api/client";

type Props = {
  sending: boolean;
  error?: string;
  onSend: (text: string, sent: () => void) => void;
  autoFocus?: boolean;
};

// The count only matters near the limit, so it stays hidden until this many are left.
const COUNT_FROM = 15;

export function CommentBox({ sending, error, onSend, autoFocus }: Props) {
  const [text, setText] = useState("");
  const counterId = useId();
  const length = commentLength(text);
  const left = MAX_COMMENT_LENGTH - length;
  const tooLong = left < 0;
  const showCount = left <= COUNT_FROM;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onSend(text, () => setText(""));
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-1.5">
      <div className="chat-compose">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          name="comment"
          autoFocus={autoFocus}
          required
          placeholder="Message the room"
          aria-label="Comment"
          aria-describedby={showCount ? counterId : undefined}
          aria-invalid={tooLong}
          autoComplete="off"
          enterKeyHint="send"
        />
        {showCount && (
          <span id={counterId} className={cn("chat-count", tooLong && "t-mine")}>
            <span aria-hidden>{left}</span>
            <span className="sr-only">{tooLong ? `${-left} over the limit` : `${left} characters left`}</span>
          </span>
        )}
        <button
          type="submit"
          className="chat-send"
          disabled={sending || length === 0 || tooLong}
          aria-label="Send comment"
          // Keeps focus (and the phone's keyboard) in the box after sending.
          onMouseDown={(e) => e.preventDefault()}
        >
          <ArrowUp className="size-[18px]" strokeWidth={2.6} />
        </button>
      </div>
      {error && (
        <p role="alert" className="first-letter:uppercase px-4 text-xs t-mine">
          {error}
        </p>
      )}
    </form>
  );
}
