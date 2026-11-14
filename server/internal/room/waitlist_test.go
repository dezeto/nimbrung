package room

import (
	"errors"
	"testing"
)

func askToJoin(t *testing.T, r *Room, hostID string, on bool) {
	t.Helper()
	if err := r.SetRules(hostID, Rules{MaxAddsPerMinute: 2, SkipVotesNeeded: 2, AskToJoin: on}); err != nil {
		t.Fatal(err)
	}
}

func TestAskToJoinKeepsNewGuestsWaitingUntilLetIn(t *testing.T) {
	r := newTestRoom(newFake())
	host := mustJoin(t, r, "Host", true)
	askToJoin(t, r, host.ID, true)

	rina := mustJoin(t, r, "Rina", false)
	if !rina.Waiting {
		t.Fatal("Rina joined straight in; want her waiting")
	}
	if st := r.State(); len(st.Guests) != 1 || len(st.Waiting) != 1 || st.Waiting[0].ID != rina.ID {
		t.Errorf("guests %+v, waiting %+v; want only the host in and Rina waiting", st.Guests, st.Waiting)
	}
	if g, ok := r.GuestBySession(rina.Session); !ok || !g.Waiting {
		t.Errorf("Rina's session finds %+v, %v; want her, waiting", g, ok)
	}
	if _, err := r.Join("rina", "", "", false); !errors.Is(err, ErrNameTaken) {
		t.Errorf("taking a waiting guest's name: %v, want ErrNameTaken", err)
	}
	if host2 := mustJoin(t, r, "Host", true); host2.Waiting {
		t.Error("the host's other device waited; want it straight in")
	}

	if err := r.LetIn(rina.ID, rina.ID); !errors.Is(err, ErrUnknownUser) {
		t.Errorf("letting yourself in: %v, want ErrUnknownUser", err)
	}
	if err := r.LetIn(host.ID, rina.ID); err != nil {
		t.Fatal(err)
	}
	if g, ok := r.GuestBySession(rina.Session); !ok || g.Waiting {
		t.Errorf("after LetIn Rina is %+v, %v; want her in", g, ok)
	}
	if err := r.LetIn(host.ID, rina.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("letting in someone already in: %v, want ErrNotFound", err)
	}
}

func TestTurningAwayAWaitingGuestRemovesThemQuietly(t *testing.T) {
	r := newTestRoom(newFake())
	host := mustJoin(t, r, "Host", true)
	askToJoin(t, r, host.ID, true)
	rina := mustJoin(t, r, "Rina", false)

	if err := r.Kick(host.ID, rina.ID); err != nil {
		t.Fatal(err)
	}
	st := r.State()
	if _, ok := r.GuestBySession(rina.Session); ok || !r.Kicked(rina.Session) || len(st.Waiting) != 0 {
		t.Errorf("Rina still found %v, removed %v, %d waiting; want gone and removed", ok, r.Kicked(rina.Session), len(st.Waiting))
	}
	if len(st.Feed) != 0 {
		t.Errorf("feed = %+v, want nothing: she was never in", st.Feed)
	}
}

func TestTurningAskToJoinOffLetsEveryoneWaitingIn(t *testing.T) {
	r := newTestRoom(newFake())
	host := mustJoin(t, r, "Host", true)
	askToJoin(t, r, host.ID, true)
	mustJoin(t, r, "Rina", false)
	mustJoin(t, r, "Dimas", false)

	askToJoin(t, r, host.ID, false)
	if st := r.State(); len(st.Guests) != 3 || len(st.Waiting) != 0 {
		t.Errorf("%d in, %d waiting; want all 3 in", len(st.Guests), len(st.Waiting))
	}
	if g := mustJoin(t, r, "Elsewhere", false); g.Waiting {
		t.Error("joined after turning it off and still waited")
	}
}
