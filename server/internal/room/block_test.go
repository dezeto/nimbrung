package room

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestBlockRemovesTheGuestAndKeepsTheirNetworkOutUntilUnblocked(t *testing.T) {
	r := newTestRoom(newFake())
	host := mustJoin(t, r, "Host", true)
	rina, _ := r.Join("Rina", "", "203.0.113.7", false)
	friend, _ := r.Join("Dimas", "", "203.0.113.7", false) // same Wi-Fi

	if err := r.Block(host.ID, rina.ID); err != nil {
		t.Fatal(err)
	}
	if _, in := r.GuestBySession(rina.Session); in || !r.Kicked(rina.Session) {
		t.Errorf("Rina still in %v, removed %v; want out and removed", in, r.Kicked(rina.Session))
	}
	if _, in := r.GuestBySession(friend.Session); !in {
		t.Error("Dimas, already in from the same network, was removed too; want him kept")
	}
	if _, err := r.Join("Rina again", "", "203.0.113.7", false); !errors.Is(err, ErrBlocked) {
		t.Errorf("join from the blocked network: %v, want ErrBlocked", err)
	}
	if _, err := r.Join("Host", "", "203.0.113.7", true); err != nil {
		t.Errorf("the host joining from the blocked network: %v, want in", err)
	}
	mustJoin(t, r, "Elsewhere", false) // other networks still get in

	blocked := r.State().Blocked
	if len(blocked) != 1 || blocked[0].Name != "Rina" {
		t.Fatalf("blocked = %+v, want Rina's network", blocked)
	}
	if err := r.Unblock(rina.ID, blocked[0].ID); !errors.Is(err, ErrUnknownUser) {
		t.Errorf("unblock by someone not in: %v, want ErrUnknownUser", err)
	}
	if err := r.Unblock(host.ID, blocked[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Join("Rina", "", "203.0.113.7", false); err != nil || len(r.State().Blocked) != 0 {
		t.Errorf("after unblocking: join %v with %d blocked; want in with none", err, len(r.State().Blocked))
	}
}

func TestBlockRules(t *testing.T) {
	cases := []struct {
		name, by, whom string // "" is an ID nobody has
		wantErr        error
	}{
		{"a guest can't block", "Rina", "Dimas", ErrNotHost},
		{"the host can't block themself", "Host", "Host", ErrKickSelf},
		{"nobody has that ID", "Host", "", ErrNotFound},
		{"a device on the host's computer can only be removed", "Host", "Local", ErrCantBlock},
		{"the host blocks a guest", "Host", "Rina", nil},
	}
	for _, c := range cases {
		r := newTestRoom(newFake())
		ids := map[string]string{"": "nope"}
		for _, g := range []struct {
			name, ip string
			host     bool
		}{{"Host", "", true}, {"Local", "", false}, {"Rina", "203.0.113.7", false}, {"Dimas", "203.0.113.8", false}} {
			joined, _ := r.Join(g.name, "", g.ip, g.host)
			ids[g.name] = joined.ID
		}
		err := r.Block(ids[c.by], ids[c.whom])
		want := 4
		if c.wantErr == nil {
			want = 3
		}
		if got := len(r.State().Guests); !errors.Is(err, c.wantErr) || got != want {
			t.Errorf("%s: err = %v with %d left; want %v with %d left", c.name, err, got, c.wantErr, want)
		}
	}
}

func TestJoinsFromOneNetworkAreCapped(t *testing.T) {
	const network = "203.0.113.7"
	cases := []struct {
		name   string
		full   string // the network that used up its joins
		ip     string
		isHost bool
		after  time.Duration
		want   error
	}{
		{"one more guest from that network", network, network, false, 0, ErrManyJoins},
		{"a guest from another network", network, "198.51.100.2", false, 0, nil},
		{"the host from that network", network, network, true, 0, nil},
		{"that network once the window has passed", network, network, false, joinWindow, nil},
		{"a device on the host's computer, however many came before", "", "", false, 0, nil},
	}
	for _, c := range cases {
		r := newTestRoom(newFake())
		start := time.Now()
		r.now = func() time.Time { return start }
		for i := range joinsPerNetwork {
			if _, err := r.Join(fmt.Sprintf("Guest %d", i), "", c.full, false); err != nil {
				t.Fatalf("%s: join %d: %v", c.name, i, err)
			}
		}
		r.now = func() time.Time { return start.Add(c.after) }
		if _, err := r.Join("Late", "", c.ip, c.isHost); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", c.name, err, c.want)
		}
	}
}
