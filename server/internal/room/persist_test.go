package room

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/dezeto/nimbrung/internal/ytm"
)

func TestARestartKeepsGuestsAndWhoAddedWhat(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "jam.json")
	p := newFake(ytm.Track{VideoID: "playing"}, ytm.Track{VideoID: "a"}, ytm.Track{VideoID: "radio"})

	before := newTestRoom(p)
	if err := before.Persist(path); err != nil {
		t.Fatal(err)
	}
	rina := mustJoin(t, before, "Rina", false)
	before.mu.Lock()
	before.owners["a"] = rina.ID
	before.mu.Unlock()
	if err := before.Refresh(ctx); err != nil {
		t.Fatal(err)
	}

	after := newTestRoom(p) // same code, same player, fresh memory
	if err := after.Persist(path); err != nil {
		t.Fatal(err)
	}
	if g, ok := after.GuestBySession(rina.Session); !ok || g.Name != "Rina" {
		t.Fatalf("Rina's cookie no longer works after the restart: %v %v", g, ok)
	}
	_ = after.Refresh(ctx)
	st := after.State()
	if len(st.Queue) < 1 || st.Queue[0].AddedBy != "Rina" {
		t.Fatalf("up next lost who added it: %+v", st.Queue)
	}
	for _, e := range st.Feed {
		if e.Kind == FeedAdded {
			t.Errorf("the restart announced an old add again: %+v", e)
		}
	}

	other := New("ZZZZ", "another jam", p, DefaultRules, nil)
	if err := other.Persist(path); err != nil {
		t.Fatal(err)
	}
	if _, ok := other.GuestBySession(rina.Session); ok {
		t.Error("a room with another code took over the saved guests")
	}
}
