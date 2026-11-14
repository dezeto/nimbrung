package room

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/dezeto/nimbrung/internal/ytm"
)

func TestRecapRemembersWhatPlayedAndItsReactions(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "jam.json")
	p := newFake(ytm.Track{VideoID: "a", Title: "A"}, ytm.Track{VideoID: "b", Title: "B"})
	r := newTestRoom(p)
	_ = r.Persist(path)
	rina := mustJoin(t, r, "Rina", false)
	r.mu.Lock()
	r.owners["b"] = rina.ID
	r.mu.Unlock()

	_ = r.Refresh(ctx)
	_ = r.Refresh(ctx) // same song: still one entry
	_ = p.Next(ctx)
	_ = r.Refresh(ctx)
	_ = r.React(rina.ID, ReactionFire)
	_ = r.React(rina.ID, ReactionFire)

	played := r.Recap().Played
	if len(played) != 2 || played[0].VideoID != "a" || played[1].VideoID != "b" {
		t.Fatalf("played = %+v, want a then b", played)
	}
	if played[1].AddedBy != "Rina" || played[1].AddedByAvatar == "" || played[1].Reactions[ReactionFire] != 2 {
		t.Errorf("b should be Rina's with 2 fires: %+v", played[1])
	}
	if played[0].Reactions[ReactionFire] != 0 {
		t.Errorf("reactions to b landed on a: %+v", played[0])
	}

	_ = r.Refresh(ctx) // saves the reactions
	after := newTestRoom(p)
	_ = after.Persist(path)
	_ = after.Refresh(ctx) // b still playing: not counted again
	if got := after.Recap().Played; len(got) != 2 || got[1].Reactions[ReactionFire] != 2 {
		t.Errorf("a restart lost or repeated the history: %+v", got)
	}
}
