package room

import "slices"

// Blocked is a network the host blocked, named after the guest removed with
// it. Its IP never leaves the server.
type Blocked struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	IP   string `json:"-"`
}

// Block removes a guest like Kick and refuses joins from their IP until
// Unblock. Guests already in from that IP stay. A guest with no IP joined
// from the host's own computer, where a tunnel brings everyone in from; it
// can only be removed.
func (r *Room) Block(hostID, guestID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	g, err := r.kickableLocked(hostID, guestID)
	if err != nil {
		return err
	}
	if g.IP == "" {
		return ErrCantBlock
	}
	if !r.blockedLocked(g.IP) {
		r.blocked = append(r.blocked, Blocked{ID: newID(), Name: g.Name, IP: g.IP})
		r.state.Blocked = slices.Clone(r.blocked)
	}
	r.kickLocked(guestID)
	r.broadcastLocked()
	return nil
}

// Unblock lets joins from a blocked network in again.
func (r *Room) Unblock(hostID, blockedID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.hostOnlyLocked(hostID); err != nil {
		return err
	}
	i := slices.IndexFunc(r.blocked, func(b Blocked) bool { return b.ID == blockedID })
	if i < 0 {
		return ErrNotFound
	}
	r.blocked = slices.Delete(r.blocked, i, i+1)
	r.state.Blocked = slices.Clone(r.blocked)
	r.broadcastLocked()
	return nil
}

func (r *Room) blockedLocked(ip string) bool {
	return ip != "" && slices.ContainsFunc(r.blocked, func(b Blocked) bool { return b.IP == ip })
}
