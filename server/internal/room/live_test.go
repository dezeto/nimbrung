package room

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/dezeto/nimbrung/internal/ytm"
)

func TestReactAcceptsOnlyTheSixReactions(t *testing.T) {
	cases := []struct {
		reaction Reaction
		wantErr  error
	}{
		{ReactionFire, nil},
		{ReactionHeart, nil},
		{ReactionLaugh, nil},
		{ReactionClap, nil},
		{ReactionDance, nil},
		{ReactionParty, nil},
		{"skull", ErrBadReaction},
		{"🔥", ErrBadReaction}, // the emoji itself is not a wire value
		{"", ErrBadReaction},
	}
	for _, c := range cases {
		r := newTestRoom(newFake())
		events, stop := r.Listen()
		rina := mustJoin(t, r, "Rina", false)

		if err := r.React(rina.ID, c.reaction); !errors.Is(err, c.wantErr) {
			t.Errorf("React(%q) = %v, want %v", c.reaction, err, c.wantErr)
		}
		want := []Event{}
		if c.wantErr == nil {
			want = append(want, Event{Kind: EventReaction, Data: ReactionSent{Reaction: c.reaction, GuestID: rina.ID, Name: "Rina", Avatar: rina.Avatar}})
		}
		if got := drain(events); !slices.Equal(got, want) {
			t.Errorf("React(%q) sent %+v, want %+v", c.reaction, got, want)
		}
		stop()
	}
}

func TestCommentCountsCharactersNotBytes(t *testing.T) {
	cases := []struct {
		name, text string
		want       string // stored text; "" means refused
	}{
		{"trimmed", "  hello  ", "hello"},
		{"kept on one line", "line one\n  line two", "line one line two"},
		{"80 emoji is 80 characters (320 bytes)", strings.Repeat("🔥", 80), strings.Repeat("🔥", 80)},
		{"80 accented letters is 80 characters (160 bytes)", strings.Repeat("é", 80), strings.Repeat("é", 80)},
		{"81 emoji is one too many", strings.Repeat("🔥", 81), ""},
		{"81 letters is one too many", strings.Repeat("a", 81), ""},
		{"empty", "", ""},
		{"only spaces", " \n\t ", ""},
	}
	for _, c := range cases {
		r := newTestRoom(newFake())
		rina := mustJoin(t, r, "Rina", false)
		err := r.Comment(rina.ID, c.text)
		feed := r.State().Feed

		if c.want == "" {
			if !errors.Is(err, ErrBadComment) || len(feed) != 0 {
				t.Errorf("%s: err %v, feed %+v; want ErrBadComment and nothing posted", c.name, err, feed)
			}
			continue
		}
		if err != nil || len(feed) != 1 || feed[0].Text != c.want || feed[0].Kind != FeedComment || feed[0].Name != "Rina" {
			t.Errorf("%s: err %v, feed %+v; want Rina's comment %q", c.name, err, feed, c.want)
		}
	}
}

func TestReactionsAndCommentsAreRateLimitedPerGuest(t *testing.T) {
	cases := []struct {
		name    string
		allowed int
		window  time.Duration
		send    func(r *Room, guestID string) error
	}{
		{"20 reactions per 5 seconds", 20, 5 * time.Second, func(r *Room, id string) error { return r.React(id, ReactionFire) }},
		{"5 comments per 30 seconds", 5, 30 * time.Second, func(r *Room, id string) error { return r.Comment(id, "hey") }},
	}
	for _, c := range cases {
		r := newTestRoom(newFake())
		start := time.Now()
		r.now = func() time.Time { return start }
		host, rina, dimas := mustJoin(t, r, "host", true), mustJoin(t, r, "Rina", false), mustJoin(t, r, "Dimas", false)

		_ = r.Comment(rina.ID, "  ") // a refused comment uses up neither allowance
		for i := range c.allowed {
			if err := c.send(r, rina.ID); err != nil {
				t.Fatalf("%s: send %d: %v", c.name, i+1, err)
			}
		}
		if err := c.send(r, rina.ID); !errors.Is(err, ErrTooFast) {
			t.Errorf("%s: one more = %v, want ErrTooFast", c.name, err)
		}
		if err := c.send(r, dimas.ID); err != nil {
			t.Errorf("%s: another guest = %v, want nil", c.name, err)
		}
		for range c.allowed {
			_ = c.send(r, host.ID)
		}
		if err := c.send(r, host.ID); !errors.Is(err, ErrTooFast) {
			t.Errorf("%s: host past the limit = %v, want ErrTooFast (screens, not the queue)", c.name, err)
		}
		r.now = func() time.Time { return start.Add(c.window) }
		if err := c.send(r, rina.ID); err != nil {
			t.Errorf("%s: after the window = %v, want nil", c.name, err)
		}
	}
}

func TestFeedKeepsTheLast20Entries(t *testing.T) {
	r := newTestRoom(newFake())
	var guests []*Guest
	for _, name := range []string{"A", "B", "C", "D", "E"} {
		guests = append(guests, mustJoin(t, r, name, false))
	}
	for i := range 25 {
		if err := r.Comment(guests[i%len(guests)].ID, "#"+itoa(i+1)); err != nil {
			t.Fatal(err)
		}
	}
	feed := r.State().Feed
	if len(feed) != FeedLength || feed[0].Text != "#6" || feed[FeedLength-1].Text != "#25" {
		t.Errorf("feed has %d entries from %q to %q; want 20 from #6 to #25", len(feed), feed[0].Text, feed[len(feed)-1].Text)
	}
}

// failingAdds is the app refusing every add.
type failingAdds struct{ *fakePlayer }

func (failingAdds) AddToQueue(context.Context, string, ytm.InsertPosition) error {
	return errors.New("app said no")
}

// scene is a room with "now" playing, "a" and "b" (autoplay) up next, and
// three people in it.
type scene struct {
	r                 *Room
	p                 *fakePlayer
	rina, dimas, host string
}

func TestSongActivityGoesInTheFeedOnlyWhenItHappened(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name string
		do   func(s scene)
		want []FeedEntry // ID, GuestID and At aside
	}{
		{"an add, once the song lands", func(s scene) { _ = s.r.Add(ctx, s.rina, "s1") },
			[]FeedEntry{{Kind: FeedAdded, Name: "Rina", Title: "t-s1"}}},
		{"a guest removing their own song", func(s scene) { _ = s.r.Add(ctx, s.rina, "s1"); _ = s.r.Remove(ctx, s.rina, "s1") },
			[]FeedEntry{{Kind: FeedAdded, Name: "Rina", Title: "t-s1"}, {Kind: FeedRemoved, Name: "Rina", Title: "t-s1"}}},
		{"the host removing an autoplay song", func(s scene) { _ = s.r.Remove(ctx, s.host, "a") },
			[]FeedEntry{{Kind: FeedRemoved, Name: "Host", Title: "Song A"}}},
		{"a move to the top is slot 1", func(s scene) { _ = s.r.Move(ctx, s.rina, "b", 0) },
			[]FeedEntry{{Kind: FeedMoved, Name: "Rina", Title: "Song B", Position: 1}}},
		{"a move past the end is the last slot", func(s scene) { _ = s.r.Move(ctx, s.rina, "a", 9) },
			[]FeedEntry{{Kind: FeedMoved, Name: "Rina", Title: "Song A", Position: 2}}},
		{"the host's skip is the host's", func(s scene) { _, _, _ = s.r.VoteSkip(ctx, s.host) },
			[]FeedEntry{{Kind: FeedSkipped, Name: "Host", Title: "Now"}}},
		{"a skip by votes counts the votes", func(s scene) { s.vote(ctx, s.rina); s.vote(ctx, s.dimas) },
			[]FeedEntry{{Kind: FeedSkipped, Title: "Now", Votes: 2}}},
		{"one vote short of a skip says nothing", func(s scene) { s.vote(ctx, s.rina) }, nil},
		{"autoplay adding a song says nothing", func(s scene) { s.p.queue = append(s.p.queue, ytm.Track{VideoID: "radio"}); _ = s.r.Refresh(ctx) }, nil},
		{"removing someone else's song says nothing", func(s scene) { _ = s.r.Remove(ctx, s.rina, "a") }, nil},
		{"removing a song that isn't queued says nothing", func(s scene) { _ = s.r.Remove(ctx, s.host, "nope") }, nil},
		{"moving a song that isn't queued says nothing", func(s scene) { _ = s.r.Move(ctx, s.rina, "nope", 0) }, nil},
	}
	for _, c := range cases {
		p := newFake(ytm.Track{VideoID: "now", Title: "Now"}, ytm.Track{VideoID: "a", Title: "Song A"}, ytm.Track{VideoID: "b", Title: "Song B"})
		r := newTestRoom(p)
		s := scene{r, p, mustJoin(t, r, "Rina", false).ID, mustJoin(t, r, "Dimas", false).ID, mustJoin(t, r, "Host", true).ID}
		_ = r.Refresh(ctx)

		c.do(s)
		if got := withoutIDs(r.State().Feed); !slices.Equal(got, c.want) {
			t.Errorf("%s: feed %+v, want %+v", c.name, got, c.want)
		}
	}
}

func (s scene) vote(ctx context.Context, guestID string) { _, _, _ = s.r.VoteSkip(ctx, guestID) }

func TestAKickGoesInTheFeedUnderTheRemovedGuestsName(t *testing.T) {
	r := newTestRoom(newFake())
	host, rina, dimas := mustJoin(t, r, "Host", true), mustJoin(t, r, "Rina", false), mustJoin(t, r, "Dimas", false)

	_ = r.Kick(dimas.ID, rina.ID) // refused: Dimas isn't the host
	if err := r.Kick(host.ID, rina.ID); err != nil {
		t.Fatal(err)
	}
	feed := r.State().Feed
	if want := []FeedEntry{{Kind: FeedKicked, Name: "Rina"}}; !slices.Equal(withoutIDs(feed), want) || feed[0].GuestID != rina.ID {
		t.Errorf("feed %+v, want only %+v with Rina's ID", feed, want)
	}
}

func TestAFailedAddSaysNothing(t *testing.T) {
	ctx := context.Background()
	r := newTestRoom(failingAdds{newFake(ytm.Track{VideoID: "now"})})
	rina := mustJoin(t, r, "Rina", false)
	_ = r.Refresh(ctx)

	if err := r.Add(ctx, rina.ID, "s1"); err == nil {
		t.Fatal("want the app's error")
	}
	_ = r.Refresh(ctx)
	if feed := r.State().Feed; len(feed) != 0 {
		t.Errorf("feed = %+v, want nothing", feed)
	}
}

func TestEventsNeverBlockTheRoomOrHoldUpSnapshots(t *testing.T) {
	r := newTestRoom(newFake())
	snapshots, stopSnapshots := r.Subscribe()
	defer stopSnapshots()
	_, stopEvents := r.Listen() // never read: the slowest listener there is
	defer stopEvents()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for _, name := range []string{"A", "B", "C", "D"} {
			g := mustJoin(t, r, name, false)
			for range reactionsPerWindow {
				_ = r.React(g.ID, ReactionFire) // 80 in all, past listenBuffer
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("reacting blocked on a listener that never reads")
	}
	if st := <-snapshots; len(st.Guests) != 4 {
		t.Errorf("pending snapshot has %d guests, want the newest with 4", len(st.Guests))
	}
}

func drain(ch <-chan Event) []Event {
	out := []Event{}
	for {
		select {
		case e := <-ch:
			out = append(out, e)
		default:
			return out
		}
	}
}

func withoutIDs(feed []FeedEntry) []FeedEntry {
	var out []FeedEntry
	for _, e := range feed {
		e.ID, e.GuestID, e.Avatar, e.At = "", "", "", time.Time{} // avatars are free picks
		out = append(out, e)
	}
	return out
}
