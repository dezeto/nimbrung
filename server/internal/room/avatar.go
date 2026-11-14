package room

// Avatars are the faces a guest can pick when joining; the web's join screen
// shows them in this order.
var Avatars = []string{"🦊", "🐼", "🐸", "🦄", "🐙", "🌵", "👽", "🐯", "🍄", "🎧", "🌈", "🐧"}

// AvatarsTaken lists the faces someone in the jam or waiting already has,
// for the join screen to grey out.
func (r *Room) AvatarsTaken() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, a := range Avatars {
		if r.avatarTakenLocked(a) {
			out = append(out, a)
		}
	}
	return out
}

func (r *Room) avatarTakenLocked(avatar string) bool {
	for _, guests := range []map[string]*Guest{r.guests, r.waiting} {
		for _, g := range guests {
			if g.Avatar == avatar {
				return true
			}
		}
	}
	return false
}

// freeAvatarLocked is the first face nobody has, "" when all are taken
// (then faces repeat: a 13th guest still gets in).
func (r *Room) freeAvatarLocked() string {
	for _, a := range Avatars {
		if !r.avatarTakenLocked(a) {
			return a
		}
	}
	return ""
}
