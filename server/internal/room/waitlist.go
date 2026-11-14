package room

// LetIn moves a guest from waiting into the jam, at the host's request.
func (r *Room) LetIn(hostID, guestID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.hostOnlyLocked(hostID); err != nil {
		return err
	}
	if _, ok := r.waiting[guestID]; !ok {
		return ErrNotFound
	}
	r.letInLocked(guestID)
	r.broadcastLocked()
	return nil
}

// letInLocked moves a waiting guest in; the caller broadcasts.
func (r *Room) letInLocked(guestID string) {
	g := r.waiting[guestID]
	delete(r.waiting, guestID)
	g.Waiting, g.JoinedAt = false, r.now()
	r.guests[guestID] = g
	r.state.Guests, r.state.Waiting = r.guestListLocked(), r.waitingListLocked()
}
