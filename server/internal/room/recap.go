package room

import (
	"maps"
	"time"

	"github.com/dezeto/nimbrung/internal/ytm"
)

// Played is one song the jam heard, with who added it at the time (so it
// outlives Leave) and the reactions it got while it played.
type Played struct {
	ytm.Track
	AddedByID     string           `json:"addedById,omitempty"`
	AddedBy       string           `json:"addedBy,omitempty"`
	AddedByAvatar string           `json:"addedByAvatar,omitempty"`
	StartedAt     time.Time        `json:"startedAt"`
	Reactions     map[Reaction]int `json:"reactions,omitempty"`
}

// Recap is tonight so far, for the recap screen; the web does the sums.
type Recap struct {
	Name   string    `json:"name"`
	People int       `json:"people"`
	Played []Played  `json:"played"`
	Now    time.Time `json:"now"` // so the last song's length doesn't need the phone's clock
}

// historyLength caps what Recap remembers: a long night is ~150 songs.
const historyLength = 500

// Recap returns what played tonight, oldest first.
func (r *Room) Recap() Recap {
	r.mu.Lock()
	defer r.mu.Unlock()
	played := make([]Played, len(r.history))
	for i, p := range r.history {
		p.Reactions = maps.Clone(p.Reactions) // React keeps counting into the original
		played[i] = p
	}
	return Recap{Name: r.name, People: len(r.guests), Played: played, Now: r.now()}
}

// notePlayedLocked adds the current song to the history when it changed.
// The last entry is the song playing, so after a restart the same song isn't
// counted twice.
func (r *Room) notePlayedLocked(np *NowPlaying) {
	if np == nil || np.VideoID == "" {
		return
	}
	if n := len(r.history); n > 0 && r.history[n-1].VideoID == np.VideoID {
		return
	}
	r.history = append(r.history[max(0, len(r.history)-historyLength+1):], Played{
		Track:         np.Track,
		AddedByID:     np.AddedByID,
		AddedBy:       np.AddedBy,
		AddedByAvatar: np.AddedByAvatar,
		StartedAt:     r.now(),
	})
}

// countReactionLocked credits a reaction to the song playing.
func (r *Room) countReactionLocked(x Reaction) {
	n := len(r.history)
	if n == 0 || r.state.NowPlaying == nil || r.history[n-1].VideoID != r.state.NowPlaying.VideoID {
		return
	}
	if r.history[n-1].Reactions == nil {
		r.history[n-1].Reactions = map[Reaction]int{}
	}
	r.history[n-1].Reactions[x]++
}
