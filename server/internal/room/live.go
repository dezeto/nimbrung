package room

import (
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Reaction is one of the emoji guests can tap. The wire value is a stable
// name, not the emoji, so the UI can change how it draws one; the web UI's
// Reaction enum must match.
type Reaction string

const (
	ReactionFire  Reaction = "fire"  // 🔥
	ReactionHeart Reaction = "heart" // ❤️
	ReactionLaugh Reaction = "laugh" // 😂
	ReactionClap  Reaction = "clap"  // 👏
	ReactionDance Reaction = "dance" // 💃
	ReactionParty Reaction = "party" // 🎉
)

func (x Reaction) known() bool {
	switch x {
	case ReactionFire, ReactionHeart, ReactionLaugh, ReactionClap, ReactionDance, ReactionParty:
		return true
	}
	return false
}

// ReactionSent is a reaction on its way to every screen. It is never stored:
// it only matters while it floats up.
type ReactionSent struct {
	Reaction Reaction `json:"reaction"`
	GuestID  string   `json:"guestId"`
	Name     string   `json:"name"`
	Avatar   string   `json:"avatar,omitempty"`
}

// FeedKind says what a feed entry is: a guest's comment, something that
// happened to a guest's song, or the host removing a guest. The web UI's
// FeedKind enum must match.
type FeedKind string

const (
	FeedComment  FeedKind = "comment"
	FeedAdded    FeedKind = "added"
	FeedRemoved  FeedKind = "removed"
	FeedMoved    FeedKind = "moved"
	FeedSkipped  FeedKind = "skipped"
	FeedShuffled FeedKind = "shuffled" // someone shuffled Up Next
	FeedKicked   FeedKind = "kicked"   // the host removed a guest
)

// FeedEntry is one line of the room's chat. Comments and song activity share
// one list so a late joiner reads them in the order they happened.
type FeedEntry struct {
	ID       string    `json:"id"`
	Kind     FeedKind  `json:"kind"`
	GuestID  string    `json:"guestId,omitempty"`  // who; empty for a skip by votes, the removed guest for a kick
	Name     string    `json:"name,omitempty"`     // their name at the time, so it outlives Leave
	Avatar   string    `json:"avatar,omitempty"`   // their face at the time, likewise
	Text     string    `json:"text,omitempty"`     // comments only
	Title    string    `json:"title,omitempty"`    // the song, for activity
	Position int       `json:"position,omitempty"` // moved: 1-based slot in Up Next
	Votes    int       `json:"votes,omitempty"`    // skipped by votes: how many
	At       time.Time `json:"at"`
}

// EventKind says what an Event carries.
type EventKind int

const (
	EventReaction EventKind = iota // Data is a ReactionSent
	EventFeed                      // Data is a FeedEntry
)

// Event is a moment pushed to listeners as it happens, beside the snapshots.
type Event struct {
	Kind EventKind
	Data any
}

const (
	// MaxCommentLength caps comments, in characters, so one fits on a line
	// sliding across a phone screen.
	MaxCommentLength = 80

	// FeedLength is how many recent entries State keeps for late joiners.
	FeedLength = 20

	// Reactions are for spamming along to a drop: a burst of 20 goes through,
	// held down it's four a second. Enough to feel live, not enough for one
	// guest to fill every screen.
	reactionsPerWindow = 20
	reactionWindow     = 5 * time.Second

	// Five comments in 30 seconds keeps a quick back-and-forth going, but one
	// guest needs two minutes to push everyone else out of the feed.
	commentsPerWindow = 5
	commentWindow     = 30 * time.Second

	// listenBuffer is how far a listener may fall behind (a whole room
	// tapping between two flushes) before it starts missing events.
	listenBuffer = 32
)

// liveShow is the room's live side: how fast each guest may react and
// comment, and who listens for those moments. Unlike adds, the host is
// limited too: these limits guard the screens, not the queue. Guarded by
// Room.mu.
type liveShow struct {
	reactions *limiter
	comments  *limiter
	listeners map[chan Event]struct{}
}

func newLiveShow() liveShow {
	return liveShow{
		reactions: newLimiter(reactionsPerWindow, reactionWindow),
		comments:  newLimiter(commentsPerWindow, commentWindow),
		listeners: map[chan Event]struct{}{},
	}
}

// React sends a reaction to every screen.
func (r *Room) React(guestID string, reaction Reaction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	g, ok := r.guests[guestID]
	if !ok {
		return ErrUnknownUser
	}
	if !reaction.known() {
		return ErrBadReaction
	}
	if !r.live.reactions.allow(guestID, r.now()) {
		return ErrTooFast
	}
	r.countReactionLocked(reaction)
	r.emitLocked(Event{Kind: EventReaction, Data: ReactionSent{Reaction: reaction, GuestID: g.ID, Name: g.Name, Avatar: g.Avatar}})
	return nil
}

// Comment posts a one-line message to the feed. Whitespace runs, newlines
// included, become single spaces so it stays one line. A refused comment
// doesn't use up the guest's allowance.
func (r *Room) Comment(guestID, text string) error {
	text = strings.Join(strings.Fields(text), " ")
	r.mu.Lock()
	defer r.mu.Unlock()
	g, ok := r.guests[guestID]
	if !ok {
		return ErrUnknownUser
	}
	if text == "" || utf8.RuneCountInString(text) > MaxCommentLength {
		return ErrBadComment
	}
	if !r.live.comments.allow(guestID, r.now()) {
		return ErrTooFast
	}
	r.recordLocked(FeedEntry{Kind: FeedComment, GuestID: g.ID, Name: g.Name, Text: text})
	r.broadcastLocked()
	return nil
}

// Listen returns a channel of reactions and feed entries as they happen.
// Unlike snapshots there is nothing to coalesce, so a listener that falls
// behind misses events instead of blocking the room; feed entries are in
// State too, so all it loses is the animation.
func (r *Room) Listen() (<-chan Event, func()) {
	ch := make(chan Event, listenBuffer)
	r.mu.Lock()
	r.live.listeners[ch] = struct{}{}
	r.mu.Unlock()
	return ch, func() {
		r.mu.Lock()
		delete(r.live.listeners, ch)
		r.mu.Unlock()
	}
}

func (r *Room) emitLocked(e Event) {
	for ch := range r.live.listeners {
		select {
		case ch <- e:
		default:
		}
	}
}

// recordLocked appends e to the feed, keeping the last FeedLength, and tells
// listeners; the caller broadcasts the snapshot. The slice is copied rather
// than appended in place because earlier snapshots still share it.
func (r *Room) recordLocked(e FeedEntry) {
	e.ID = newID()
	e.At = r.now()
	if g, ok := r.guests[e.GuestID]; ok {
		e.Avatar = g.Avatar
	}
	keep := r.state.Feed[max(0, len(r.state.Feed)-FeedLength+1):]
	r.state.Feed = append(slices.Clone(keep), e)
	r.emitLocked(Event{Kind: EventFeed, Data: e})
}

// skipEntry credits a host's skip to the host and a vote skip to the votes:
// the guest whose vote tipped it didn't skip on their own.
func skipEntry(g *Guest, np *NowPlaying, votes int) FeedEntry {
	e := FeedEntry{Kind: FeedSkipped}
	if np != nil {
		e.Title = np.Title
	}
	if g.IsHost {
		e.GuestID, e.Name = g.ID, g.Name
	} else {
		e.Votes = votes
	}
	return e
}
