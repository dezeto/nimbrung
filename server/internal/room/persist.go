package room

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"slices"
	"strings"
)

// saved is what survives a restart: who's in (with the session their cookie
// carries, so nobody has to join again) and who added what (so Up Next, which
// ends at the last guest's song, comes back), and what played for the recap. Chat, votes and nudges are
// moment-to-moment and start fresh.
type saved struct {
	Code    string            `json:"code"`
	Guests  []savedGuest      `json:"guests"`
	Owners  map[string]string `json:"owners"` // videoID -> guest ID
	Kicked  []string          `json:"kicked"`
	Blocked []savedBlocked    `json:"blocked"`
	History []Played          `json:"history"`
}

// The room's own types keep Session and IP out of JSON so they never reach a
// screen; the file needs them.
type savedGuest struct {
	Guest
	Session string `json:"session"`
	IP      string `json:"ip"`
}

type savedBlocked struct {
	Blocked
	IP string `json:"ip"`
}

// Persist loads the jam saved at path, if it's this room's (same code), and
// keeps saving there from then on. A missing file just means a fresh jam.
func (r *Room) Persist(path string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.savePath = path
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var s saved
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	if s.Code != r.code {
		return nil // another room's jam: its guests and songs don't belong here
	}
	for _, sg := range s.Guests {
		g := sg.Guest
		g.Session, g.IP = sg.Session, sg.IP
		r.guests[g.ID] = &g
	}
	// Guests from before avatars get a free face, in the order they're saved.
	for _, sg := range s.Guests {
		if g := r.guests[sg.ID]; g.Avatar == "" {
			g.Avatar = cmp.Or(r.freeAvatarLocked(), Avatars[0])
		}
	}
	for videoID, owner := range s.Owners {
		r.owners[videoID] = owner
		r.landed[videoID] = true // already in the feed before the restart; don't announce it again
	}
	r.kicked = s.Kicked
	for _, sb := range s.Blocked {
		b := sb.Blocked
		b.IP = sb.IP
		r.blocked = append(r.blocked, b)
	}
	r.history = s.History
	r.lastSaved = data
	r.state.Guests = r.guestListLocked()
	return nil
}

// saveLocked writes the jam to savePath when it changed since the last save.
// Called on every Refresh, so a restart loses at most a second of it.
// Waiting guests aren't saved: they just ask again.
func (r *Room) saveLocked() {
	if r.savePath == "" {
		return
	}
	s := saved{Code: r.code, Owners: r.owners, Kicked: r.kicked, History: r.history}
	for _, g := range r.guests {
		s.Guests = append(s.Guests, savedGuest{Guest: *g, Session: g.Session, IP: g.IP})
	}
	// Map order is random; sorted, an unchanged jam marshals to the same bytes.
	slices.SortFunc(s.Guests, func(a, b savedGuest) int { return strings.Compare(a.ID, b.ID) })
	for _, b := range r.blocked {
		s.Blocked = append(s.Blocked, savedBlocked{Blocked: b, IP: b.IP})
	}
	data, err := json.Marshal(s)
	if err != nil || bytes.Equal(data, r.lastSaved) {
		return
	}
	// Write then rename, so a crash mid-write never leaves half a file.
	tmp := r.savePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		r.log.Warn("couldn't save the jam", "err", err)
		return
	}
	if err := os.Rename(tmp, r.savePath); err != nil {
		r.log.Warn("couldn't save the jam", "err", err)
		return
	}
	r.lastSaved = data
}
