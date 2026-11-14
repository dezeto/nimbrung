package room

import (
	"context"
	"slices"
	"time"
)

// Nudge is a guest asking the host to turn it up or down; guests never touch
// the volume themselves. The web UI's VolumeNudge enum must match.
type Nudge string

const (
	NudgeLouder  Nudge = "louder"
	NudgeQuieter Nudge = "quieter"
)

// Nudges lists the guests (by public ID) nudging each way.
type Nudges map[Nudge][]string

// NudgeWindow is how long a nudge counts. The host turning the volume or
// muting answers every nudge at once.
const NudgeWindow = 2 * time.Minute

type nudge struct {
	way Nudge
	at  time.Time
}

// SetVolume sets the player's volume, clamped to 0–100. Host only.
func (r *Room) SetVolume(ctx context.Context, guestID string, level int) error {
	if err := r.hostOnly(guestID); err != nil {
		return err
	}
	if err := r.player.SetVolume(ctx, min(max(level, 0), 100)); err != nil {
		return err
	}
	r.answerNudges()
	return r.Refresh(ctx)
}

// SetMuted mutes or unmutes the player. Host only.
func (r *Room) SetMuted(ctx context.Context, guestID string, muted bool) error {
	if err := r.hostOnly(guestID); err != nil {
		return err
	}
	if err := r.player.SetMuted(ctx, muted); err != nil {
		return err
	}
	r.answerNudges()
	return r.Refresh(ctx)
}

// NudgeVolume records that a guest wants it louder or quieter. Each guest
// counts once, their latest way, so tapping again needs no rate limit.
func (r *Room) NudgeVolume(guestID string, way Nudge) error {
	if way != NudgeLouder && way != NudgeQuieter {
		return ErrBadNudge
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.guests[guestID]; !ok {
		return ErrUnknownUser
	}
	r.nudges[guestID] = nudge{way: way, at: r.now()}
	r.state.Nudges = r.nudgesLocked()
	r.broadcastLocked()
	return nil
}

// WithdrawNudge takes back this guest's ask, if they have one standing.
func (r *Room) WithdrawNudge(guestID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nudges[guestID]; !ok {
		return
	}
	delete(r.nudges, guestID)
	r.state.Nudges = r.nudgesLocked()
	r.broadcastLocked()
}

func (r *Room) answerNudges() {
	r.mu.Lock()
	defer r.mu.Unlock()
	clear(r.nudges)
}

// nudgesLocked drops nudges older than NudgeWindow and lists the rest, IDs
// sorted so the snapshot doesn't reshuffle every poll.
func (r *Room) nudgesLocked() Nudges {
	now := r.now()
	var out Nudges
	for id, n := range r.nudges {
		if now.Sub(n.at) >= NudgeWindow {
			delete(r.nudges, id)
			continue
		}
		if out == nil {
			out = Nudges{}
		}
		out[n.way] = append(out[n.way], id)
	}
	for _, ids := range out {
		slices.Sort(ids)
	}
	return out
}
