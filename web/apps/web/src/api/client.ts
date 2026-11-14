// The port to the Go server: plain fetch wrappers plus the JSON shapes it
// sends (mirrors room.State and friends). Nothing else in the UI calls fetch.

export type Track = {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  thumb?: string;
  duration: number; // seconds, 0 if unknown
};

export type NowPlaying = Track & {
  elapsed: number;
  isPaused: boolean;
  addedById?: string;
  addedBy?: string;
  addedByAvatar?: string;
};

// No addedBy means the player queued it itself (autoplay / radio).
export type QueueItem = Track & {
  index: number;
  addedById?: string;
  addedBy?: string;
  addedByAvatar?: string;
};

export type Guest = {
  id: string;
  name: string;
  avatar?: string; // one of RoomInfo.avatars.all
  isHost: boolean;
  joinedAt: string;
  adds: number;
};

export type Rules = {
  maxAddsPerMinute: number;
  skipVotesNeeded: number;
  askToJoin: boolean; // new guests wait until the host lets them in
};

export type PlayerStatus = { connected: boolean; error?: string };

/** Reactions guests can tap; must match the Go server's room.Reaction consts. */
export enum Reaction {
  Fire = "fire",
  Heart = "heart",
  Laugh = "laugh",
  Clap = "clap",
  Dance = "dance",
  Party = "party",
}

/** A reaction on its way to every screen (mirrors room.ReactionSent). */
export type ReactionSent = { reaction: Reaction; guestId: string; name: string; avatar?: string };

/** What a feed entry is; must match the Go server's room.FeedKind consts. */
export enum FeedKind {
  Comment = "comment",
  Added = "added",
  Removed = "removed",
  Moved = "moved",
  Skipped = "skipped",
  Shuffled = "shuffled", // someone shuffled Up next
  Kicked = "kicked", // the host removed a guest; guestId and name are theirs
}

/** Feed kinds that are something happening to a song, or to a guest. */
export type ActivityKind = Exclude<FeedKind, FeedKind.Comment>;

// One line of the room's chat (mirrors room.FeedEntry), split by kind so a
// check on `kind` tells TypeScript which fields are there.
type FeedEntryBase = { id: string; guestId?: string; name?: string; avatar?: string; at: string };
export type CommentEntry = FeedEntryBase & { kind: FeedKind.Comment; text: string };
// No guestId or name means a skip by votes; votes says how many.
export type ActivityEntry = FeedEntryBase & {
  kind: ActivityKind;
  title?: string;
  position?: number; // moved: 1-based slot in Up Next
  votes?: number;
};
export type FeedEntry = CommentEntry | ActivityEntry;

// Go marshals empty slices as null, hence the `| null`s.
/** A guest asking the host for louder or quieter; must match room.Nudge. */
export enum VolumeNudge {
  Quieter = "quieter",
  Louder = "louder",
}

/** The player's loudness, 0–100 (mirrors ytm.Volume). */
export type Volume = { level: number; muted: boolean };

/** Guest IDs nudging each way, for the host (mirrors room.Nudges). */
export type Nudges = Partial<Record<VolumeNudge, string[]>>;

/** A network the host blocked, named after the guest removed with it (mirrors room.Blocked). */
export type Blocked = { id: string; name: string };

export type RoomState = {
  name: string;
  nowPlaying: NowPlaying | null;
  queue: QueueItem[] | null;
  autoplay: Track[] | null; // YouTube's guess at what plays after the queue; not in it, so read-only
  guests: Guest[] | null;
  waiting: Guest[] | null; // asked to join, longest waiting first
  skipVotes: number;
  rules: Rules;
  volume: Volume;
  nudges: Nudges | null;
  blocked: Blocked[] | null;
  player: PlayerStatus;
  feed: FeedEntry[] | null; // the last 20, oldest first
  updatedAt: string;
};

/** code and joinUrl are "" unless this browser joined or is on the host's computer. */
export type RoomInfo = {
  code: string;
  name: string;
  guests: number;
  rules: Rules;
  player: PlayerStatus;
  joinUrl: string; // LAN link, e.g. http://192.168.1.87:8080/join/35AA
  avatars: { all: string[]; taken: string[] | null }; // faces to pick on joining
};

/** One song the jam heard (mirrors room.Played). */
export type Played = Track & {
  addedById?: string;
  addedBy?: string;
  addedByAvatar?: string;
  startedAt: string;
  reactions?: Partial<Record<Reaction, number>>;
};

/** Tonight so far (mirrors room.Recap); the recap screen does the sums. */
export type Recap = { name: string; people: number; played: Played[] | null; now: string };

/** waiting: joined while the host asks to join, and not let in yet. */
export type Me = { guest: Guest; addsRemaining: number; waiting: boolean };

/** One page of search results; send `next` back as the cursor for the page after. */
/** A playlist in search results; api.playlist opens it (mirrors ytm.Playlist). */
export type Playlist = { id: string; title: string; author?: string; thumb?: string };

/** A playlist's songs: YouTube's first page, up to 100 (mirrors ytm.PlaylistPage). */
export type PlaylistPage = { title: string; tracks: Track[] };

export type SearchPage = {
  tracks: Track[];
  playlists?: Playlist[];
  next?: string;
  correctedQuery?: string;
};

/** What a search looks for; must match the Go server's ytm.SearchKind. */
export enum SearchKind {
  Songs = "songs",
  Videos = "videos",
  Playlists = "playlists",
}

/** position is the 0-based slot in Up Next the song should land in. */
export type SongMove = { videoId: string; position: number };

export enum HttpMethod {
  Post = "POST",
  Put = "PUT",
  Patch = "PATCH",
  Delete = "DELETE",
}

/** Statuses the UI does more with than show the message. */
export enum HttpStatus {
  Gone = 410, // the host removed this browser's guest (room.ErrKicked)
  TooManyRequests = 429, // over a limit (room.ErrRateLimited, room.ErrTooFast)
  NotFound = 404,
}

/** A song's lyrics (mirrors lyrics.Lyrics): timed lines when there are some, else plain text. */
export type LyricLine = { at: number; text: string }; // at: seconds into the song; "" text is an instrumental gap
export type Lyrics = { lines?: LyricLine[]; plain?: string };

/** SSE event names; must match the Go server's api.stateEvent, reactionEvent and feedEvent. */
export enum ServerEvent {
  State = "state",
  Reaction = "reaction",
  Feed = "feed",
}

/** Comments are one line of at most this many characters (room.MaxCommentLength). */
export const MAX_COMMENT_LENGTH = 80;

/**
 * A comment's length the way the server counts it: in code points, after
 * trimming. `.length` would count UTF-16 units, so an emoji would be two.
 */
export const commentLength = (text: string) => [...text.trim()].length;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every guest call answers this once the host has removed the guest. */
export const isKicked = (err: unknown) => err instanceof ApiError && err.status === HttpStatus.Gone;
export const isTooFast = (err: unknown) =>
  err instanceof ApiError && err.status === HttpStatus.TooManyRequests;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  room: () => request<RoomInfo>("/room"),
  me: () => request<Me>("/me"),
  leave: () => request<void>("/leave", { method: HttpMethod.Post }),
  recap: () => request<Recap>("/recap"),
  join: (body: { code: string; name: string; avatar?: string; hostKey?: string }) =>
    request<Guest>("/join", { method: HttpMethod.Post, body: JSON.stringify(body) }),
  search: (q: string, type: SearchKind, cursor: string) =>
    request<SearchPage>(`/search?${new URLSearchParams({ q, type, cursor })}`),
  playlist: (id: string) => request<PlaylistPage>(`/playlists/${encodeURIComponent(id)}`),
  addSong: (body: { videoId: string } | { url: string }) =>
    request<{ ok: true; addsRemaining: number }>("/queue", {
      method: HttpMethod.Post,
      body: JSON.stringify(body),
    }),
  removeSong: (videoId: string) =>
    request<void>(`/queue/${encodeURIComponent(videoId)}`, { method: HttpMethod.Delete }),
  voteSkip: () => request<{ votes: number; skipped: boolean }>("/skip", { method: HttpMethod.Post }),
  play: () => request<void>("/host/play", { method: HttpMethod.Post }),
  pause: () => request<void>("/host/pause", { method: HttpMethod.Post }),
  shuffle: () => request<void>("/shuffle", { method: HttpMethod.Post }),
  // null: no lyrics for this song.
  lyrics: (videoId: string) =>
    request<Lyrics>(`/lyrics/${encodeURIComponent(videoId)}`).catch((err) => {
      if (err instanceof ApiError && err.status === HttpStatus.NotFound) return null;
      throw err;
    }),
  react: (reaction: Reaction) =>
    request<void>("/reactions", { method: HttpMethod.Post, body: JSON.stringify({ reaction }) }),
  comment: (text: string) =>
    request<void>("/comments", { method: HttpMethod.Post, body: JSON.stringify({ text }) }),
  moveSong: ({ videoId, position }: SongMove) =>
    request<void>(`/queue/${encodeURIComponent(videoId)}`, {
      method: HttpMethod.Patch,
      body: JSON.stringify({ position }),
    }),
  setVolume: (level: number) =>
    request<void>("/host/volume", { method: HttpMethod.Put, body: JSON.stringify({ level }) }),
  setMuted: (muted: boolean) =>
    request<void>("/host/mute", { method: HttpMethod.Put, body: JSON.stringify({ muted }) }),
  nudge: (nudge: VolumeNudge) =>
    request<void>("/nudges", { method: HttpMethod.Post, body: JSON.stringify({ nudge }) }),
  withdrawNudge: () => request<void>("/nudges", { method: HttpMethod.Delete }),
  setRules: (rules: Rules) =>
    request<void>("/host/rules", { method: HttpMethod.Put, body: JSON.stringify(rules) }),
  letIn: (guestId: string) =>
    request<void>("/host/guests", { method: HttpMethod.Post, body: JSON.stringify({ guestId }) }),
  kickGuest: (guestId: string) =>
    request<void>(`/host/guests/${encodeURIComponent(guestId)}`, { method: HttpMethod.Delete }),
  blockGuest: (guestId: string) =>
    request<void>("/host/blocked", { method: HttpMethod.Post, body: JSON.stringify({ guestId }) }),
  unblock: (blockedId: string) =>
    request<void>(`/host/blocked/${encodeURIComponent(blockedId)}`, { method: HttpMethod.Delete }),
};

/** The server reports "unlimited" (host, or no rate limit) as a huge number. */
export const isUnlimited = (addsRemaining: number) => addsRemaining > 1_000_000;

export const eventsUrl = "/api/events";
