package room

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/dezeto/nimbrung/internal/ytm"
)

func TestOnlyTheHostSetsTheVolumeClampedTo0Through100(t *testing.T) {
	ctx := context.Background()
	p := newFake(ytm.Track{VideoID: "playing"})
	r := newTestRoom(p)
	host := mustJoin(t, r, "Host", true)
	rina := mustJoin(t, r, "Rina", false)

	if err := r.SetVolume(ctx, rina.ID, 10); !errors.Is(err, ErrNotHost) {
		t.Fatalf("guest SetVolume err = %v, want ErrNotHost", err)
	}
	cases := []struct{ ask, want int }{{40, 40}, {150, 100}, {-5, 0}}
	for _, c := range cases {
		if err := r.SetVolume(ctx, host.ID, c.ask); err != nil {
			t.Fatal(err)
		}
		if got := r.State().Volume.Level; got != c.want {
			t.Errorf("SetVolume(%d): level = %d, want %d", c.ask, got, c.want)
		}
	}
	if err := r.SetMuted(ctx, rina.ID, true); !errors.Is(err, ErrNotHost) {
		t.Fatalf("guest SetMuted err = %v, want ErrNotHost", err)
	}
	if err := r.SetMuted(ctx, host.ID, true); err != nil || !r.State().Volume.Muted {
		t.Fatalf("host SetMuted: err %v, muted %v", err, r.State().Volume.Muted)
	}
}

func TestEachGuestNudgesOnceAndTheLatestWayCounts(t *testing.T) {
	r := newTestRoom(newFake(ytm.Track{VideoID: "playing"}))
	rina := mustJoin(t, r, "Rina", false)
	dimas := mustJoin(t, r, "Dimas", false)

	for _, n := range []struct {
		g   *Guest
		way Nudge
	}{{rina, NudgeLouder}, {rina, NudgeLouder}, {dimas, NudgeLouder}, {dimas, NudgeQuieter}} {
		if err := r.NudgeVolume(n.g.ID, n.way); err != nil {
			t.Fatal(err)
		}
	}
	got := r.State().Nudges
	if !slices.Equal(got[NudgeLouder], []string{rina.ID}) || !slices.Equal(got[NudgeQuieter], []string{dimas.ID}) {
		t.Fatalf("nudges = %v, want louder [Rina] and quieter [Dimas]", got)
	}
	if err := r.NudgeVolume(rina.ID, "deafening"); !errors.Is(err, ErrBadNudge) {
		t.Fatalf("bad nudge err = %v, want ErrBadNudge", err)
	}
	r.WithdrawNudge(rina.ID)
	if got := r.State().Nudges; len(got[NudgeLouder]) != 0 || !slices.Equal(got[NudgeQuieter], []string{dimas.ID}) {
		t.Fatalf("after Rina withdraws, nudges = %v, want only quieter [Dimas]", got)
	}
	if err := r.NudgeVolume("nobody", NudgeLouder); !errors.Is(err, ErrUnknownUser) {
		t.Fatalf("unknown guest err = %v, want ErrUnknownUser", err)
	}
}

func TestNudgesEndWhenAnsweredOldOrTheGuestLeaves(t *testing.T) {
	ctx := context.Background()
	start := time.Now()
	cases := []struct {
		name string
		end  func(r *Room, host, rina *Guest)
	}{
		{"the host turns the volume", func(r *Room, host, _ *Guest) { _ = r.SetVolume(ctx, host.ID, 30) }},
		{"the host mutes", func(r *Room, host, _ *Guest) { _ = r.SetMuted(ctx, host.ID, true) }},
		{"the nudge gets old", func(r *Room, _, _ *Guest) {
			r.now = func() time.Time { return start.Add(NudgeWindow) }
			_ = r.Refresh(ctx)
		}},
		{"the guest leaves", func(r *Room, _, rina *Guest) { r.Leave(rina.ID) }},
		{"the host removes the guest", func(r *Room, host, rina *Guest) { _ = r.Kick(host.ID, rina.ID) }},
	}
	for _, c := range cases {
		r := newTestRoom(newFake(ytm.Track{VideoID: "playing"}))
		r.now = func() time.Time { return start }
		host := mustJoin(t, r, "Host", true)
		rina := mustJoin(t, r, "Rina", false)
		if err := r.NudgeVolume(rina.ID, NudgeQuieter); err != nil {
			t.Fatal(err)
		}
		c.end(r, host, rina)
		if got := r.State().Nudges; len(got) != 0 {
			t.Errorf("%s: nudges = %v, want none", c.name, got)
		}
	}
}

func TestRefreshKeepsTheLastVolumeWhenThePlayerCantSay(t *testing.T) {
	ctx := context.Background()
	p := newFake(ytm.Track{VideoID: "playing"})
	p.volume = ytm.Volume{Level: 65}
	r := newTestRoom(p)
	if err := r.Refresh(ctx); err != nil || r.State().Volume.Level != 65 {
		t.Fatalf("refresh: err %v, level %d, want 65", err, r.State().Volume.Level)
	}
	p.volErr = errors.New("plugin hiccup")
	if err := r.Refresh(ctx); err != nil {
		t.Fatalf("a volume error broke the refresh: %v", err)
	}
	if got := r.State().Volume.Level; got != 65 {
		t.Errorf("level after a volume error = %d, want the last one, 65", got)
	}
}
