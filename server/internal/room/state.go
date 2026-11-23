// Package room holds the jam state: who's in, what's queued and by whom, and
// the house rules (rate limit, vote-to-skip). The YouTube Music player is the
// source of truth for the queue itself; this package only annotates it with
// attribution and enforces rules before forwarding commands to the player.
package room

import (
	"errors"
	"fmt"
	"time"

	"github.com/dezeto/nimbrung/internal/ytm"
)

// Errors returned to the API layer, which maps them to HTTP statuses.
var (
	ErrNotFound    = errors.New("not found")
	ErrNotOwner    = errors.New("you can only remove songs you added")
	ErrDuplicate   = errors.New("that song is already in the queue")
	ErrRateLimited = errors.New("slow down — too many adds in the last minute")
	ErrUnknownUser = errors.New("unknown guest")
	ErrNotHost     = errors.New("host only")
	ErrNameTaken   = errors.New("someone here already goes by that name. Pick another")
	ErrBadReaction = errors.New("that's not one of the reactions")
	ErrBadComment  = fmt.Errorf("say something, in %d characters or fewer", MaxCommentLength)
	ErrTooFast     = errors.New("slow down — wait a few seconds")
	ErrKicked      = errors.New("the host removed you from the jam")
	ErrKickSelf    = errors.New("you can't remove yourself")
	ErrBadNudge    = errors.New("ask for louder or quieter")
	ErrBlocked     = errors.New("the host blocked this network from joining")
	ErrCantBlock   = errors.New("can't block a device on the host's computer, only remove it")
	ErrWaiting     = errors.New("waiting for the host to let you in")
	ErrAvatarTaken = errors.New("someone here already has that face. Pick another")
	ErrManyJoins   = errors.New("lots of people just joined from this network. Try again in a few minutes")
	ErrWrongCode   = errors.New("wrong room code")
	ErrManyGuesses = errors.New("too many wrong codes from this network. Try again in a few minutes")
)

// Rules are the host-configurable house rules.
type Rules struct {
	MaxAddsPerMinute int  `json:"maxAddsPerMinute"`
	SkipVotesNeeded  int  `json:"skipVotesNeeded"`
	AskToJoin        bool `json:"askToJoin"` // new guests wait until the host lets them in
}

// DefaultRules is what a room gets when the host doesn't configure anything.
var DefaultRules = Rules{MaxAddsPerMinute: 3, SkipVotesNeeded: 3}

// Guest is someone in the room. The host is a Guest with IsHost set.
type Guest struct {
	ID       string    `json:"id"`
	Session  string    `json:"-"` // what their cookie carries; unlike ID, never sent to anyone
	IP       string    `json:"-"` // where they joined from, for Block; "" if unknown
	Name     string    `json:"name"`
	Avatar   string    `json:"avatar,omitempty"` // one of Avatars; "" for guests saved before avatars
	IsHost   bool      `json:"isHost"`
	JoinedAt time.Time `json:"joinedAt"`
	Adds     int       `json:"adds"`              // lifetime adds, for the host's "who's in" list
	Waiting  bool      `json:"waiting,omitempty"` // asked to join, not let in yet
}

// Item is one queue row as shown to guests: the track plus who added it.
type Item struct {
	ytm.Track
	Index         int    `json:"index"`
	AddedByID     string `json:"addedById,omitempty"`
	AddedBy       string `json:"addedBy,omitempty"` // display name; empty for autoplay rows
	AddedByAvatar string `json:"addedByAvatar,omitempty"`
}

// State is the full snapshot pushed to every connected client.
type State struct {
	Name       string       `json:"name"`
	NowPlaying *NowPlaying  `json:"nowPlaying"`
	Queue      []Item       `json:"queue"`
	Autoplay   []ytm.Track  `json:"autoplay"` // YouTube's guess at what plays after Queue; not in the queue, so read-only
	Guests     []Guest      `json:"guests"`
	Waiting    []Guest      `json:"waiting"` // asked to join, longest waiting first
	SkipVotes  int          `json:"skipVotes"`
	Rules      Rules        `json:"rules"`
	Volume     ytm.Volume   `json:"volume"`
	Nudges     Nudges       `json:"nudges"` // who wants it louder or quieter, for the host
	Blocked    []Blocked    `json:"blocked"`
	Player     PlayerStatus `json:"player"`
	Feed       []FeedEntry  `json:"feed"` // last FeedLength comments and song activity, oldest first
	UpdatedAt  time.Time    `json:"updatedAt"`
}

// NowPlaying is the current song with attribution.
type NowPlaying struct {
	ytm.NowPlaying
	AddedByID     string `json:"addedById,omitempty"`
	AddedBy       string `json:"addedBy,omitempty"`
	AddedByAvatar string `json:"addedByAvatar,omitempty"`
}

// PlayerStatus tells the UI whether the desktop app is reachable.
type PlayerStatus struct {
	Connected bool   `json:"connected"`
	Error     string `json:"error,omitempty"`
}
