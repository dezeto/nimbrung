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

// fakePlayer is an in-memory ytm.Player for tests.
type fakePlayer struct {
	queue   []ytm.Track
	current int // index into queue; -1 = nothing playing
	paused  bool
	guess   []ytm.Track // what Autoplay answers
	volume  ytm.Volume
	volErr  error // what Volume fails with, if set
	artists map[string]ytm.ArtistPage
	albums  map[string]ytm.AlbumPage
}

func newFake(tracks ...ytm.Track) *fakePlayer {
	f := &fakePlayer{queue: tracks, current: -1}
	if len(tracks) > 0 {
		f.current = 0
	}
	return f
}

func (f *fakePlayer) NowPlaying(context.Context) (*ytm.NowPlaying, error) {
	if f.current < 0 || f.current >= len(f.queue) {
		return nil, nil
	}
	track := f.queue[f.current]
	track.ArtistID = "" // like the plugin's now-playing, which doesn't link the artist
	return &ytm.NowPlaying{Track: track, IsPaused: f.paused}, nil
}
func (f *fakePlayer) Queue(context.Context) ([]ytm.QueueItem, error) {
	out := make([]ytm.QueueItem, len(f.queue))
	for i, t := range f.queue {
		out[i] = ytm.QueueItem{Track: t, Index: i, Selected: i == f.current}
	}
	return out, nil
}
func (f *fakePlayer) Autoplay(context.Context) []ytm.Track { return f.guess }
func (f *fakePlayer) Search(context.Context, ytm.SearchRequest) (ytm.SearchPage, error) {
	return ytm.SearchPage{}, nil
}
func (f *fakePlayer) Playlist(_ context.Context, id string) (ytm.PlaylistPage, error) {
	return ytm.PlaylistPage{Title: id}, nil
}
func (f *fakePlayer) Artist(_ context.Context, id string) (ytm.ArtistPage, error) {
	return f.artists[id], nil
}
func (f *fakePlayer) Album(_ context.Context, id string) (ytm.AlbumPage, error) {
	return f.albums[id], nil
}

// FindTrack knows the songs in the queue and nothing else.
func (f *fakePlayer) FindTrack(_ context.Context, videoID string) (ytm.Track, error) {
	for _, t := range f.queue {
		if t.VideoID == videoID {
			return t, nil
		}
	}
	return ytm.Track{}, nil
}
func (f *fakePlayer) Suggest(_ context.Context, input string) []string {
	return []string{input + " live"}
}
func (f *fakePlayer) AddToQueue(_ context.Context, id string, pos ytm.InsertPosition) error {
	t := ytm.Track{VideoID: id, Title: "t-" + id}
	if pos == ytm.InsertAfterCurrentVideo && f.current >= 0 {
		f.queue = slices.Insert(f.queue, f.current+1, t)
	} else {
		f.queue = append(f.queue, t)
	}
	if f.current < 0 {
		f.current = 0
	}
	return nil
}
func (f *fakePlayer) RemoveFromQueue(_ context.Context, idx int) error {
	if idx < 0 || idx >= len(f.queue) {
		return errors.New("bad index")
	}
	f.queue = append(f.queue[:idx], f.queue[idx+1:]...)
	if idx < f.current {
		f.current--
	}
	return nil
}
func (f *fakePlayer) MoveInQueue(_ context.Context, from, to int) error {
	if from < 0 || from >= len(f.queue) || to < 0 || to >= len(f.queue) {
		return errors.New("bad index")
	}
	playing, moved := f.queue[f.current], f.queue[from]
	f.queue = slices.Insert(slices.Delete(f.queue, from, from+1), to, moved)
	f.current = slices.Index(f.queue, playing)
	return nil
}
func (f *fakePlayer) Next(context.Context) error {
	if f.current < len(f.queue)-1 {
		f.current++
	}
	return nil
}
func (f *fakePlayer) Play(context.Context) error                 { f.paused = false; return nil }
func (f *fakePlayer) Pause(context.Context) error                { f.paused = true; return nil }
func (f *fakePlayer) Volume(context.Context) (ytm.Volume, error) { return f.volume, f.volErr }
func (f *fakePlayer) SetVolume(_ context.Context, level int) error {
	f.volume.Level = level
	return nil
}
func (f *fakePlayer) SetMuted(_ context.Context, muted bool) error {
	f.volume.Muted = muted
	return nil
}

func newTestRoom(p ytm.Player) *Room {
	r := New("TEST", "test jam", p, Rules{MaxAddsPerMinute: 2, SkipVotesNeeded: 2}, nil)
	return r
}

func TestAddAttributesAndDedupes(t *testing.T) {
	ctx := context.Background()
	p := newFake(ytm.Track{VideoID: "playing"})
	r := newTestRoom(p)
	rina := mustJoin(t, r, "Rina", false)

	if err := r.Add(ctx, rina.ID, "s1"); err != nil {
		t.Fatal(err)
	}
	st := r.State()
	if len(st.Queue) != 1 || st.Queue[0].VideoID != "s1" || st.Queue[0].AddedBy != "Rina" {
		t.Fatalf("queue = %+v", st.Queue)
	}
	if err := r.Add(ctx, rina.ID, "s1"); !errors.Is(err, ErrDuplicate) {
		t.Errorf("want ErrDuplicate, got %v", err)
	}
	if err := r.Add(ctx, rina.ID, "playing"); !errors.Is(err, ErrDuplicate) {
		t.Errorf("adding the current song should be a duplicate, got %v", err)
	}
}

func TestGuestSongsPlayInTheOrderAddedAheadOfAutoplay(t *testing.T) {
	ctx := context.Background()
	r := newTestRoom(newFake(ytm.Track{VideoID: "playing"}, ytm.Track{VideoID: "auto1"}, ytm.Track{VideoID: "auto2"}))
	rina, dimas := mustJoin(t, r, "Rina", false), mustJoin(t, r, "Dimas", false)

	for _, add := range []struct{ guestID, videoID string }{{rina.ID, "s1"}, {dimas.ID, "s2"}, {rina.ID, "s3"}} {
		if err := r.Add(ctx, add.guestID, add.videoID); err != nil {
			t.Fatal(err)
		}
	}
	var upNext []string
	for _, it := range r.State().Queue {
		upNext = append(upNext, it.VideoID)
	}
	if got, want := strings.Join(upNext, " "), "s1 s2 s3 auto1 auto2"; got != want {
		t.Errorf("up next = %q, want %q", got, want)
	}
}

// pollingAfterLanding runs the room's background poll once the song is in the
// player's queue (right after the current one) but before the room has moved
// it behind the other guest songs.
type pollingAfterLanding struct {
	*fakePlayer
	poll func()
}

func (p *pollingAfterLanding) AddToQueue(ctx context.Context, id string, pos ytm.InsertPosition) error {
	if err := p.fakePlayer.AddToQueue(ctx, id, pos); err != nil {
		return err
	}
	p.poll()
	return nil
}

func TestAGuestSongShowsUpOnlyInItsFinalSlot(t *testing.T) {
	ctx := context.Background()
	p := &pollingAfterLanding{fakePlayer: newFake(ytm.Track{VideoID: "playing"}, ytm.Track{VideoID: "auto1"})}
	r := newTestRoom(p)
	var seenMidAdd string
	p.poll = func() {
		_ = r.Refresh(ctx)
		seenMidAdd = upNextIDs(r)
	}
	rina, dimas := mustJoin(t, r, "Rina", false), mustJoin(t, r, "Dimas", false)

	if err := r.Add(ctx, rina.ID, "s1"); err != nil {
		t.Fatal(err)
	}
	if err := r.Add(ctx, dimas.ID, "s2"); err != nil {
		t.Fatal(err)
	}
	if want := "s1 auto1"; seenMidAdd != want {
		t.Errorf("mid-add up next = %q, want %q (s2 hidden until it reaches its slot)", seenMidAdd, want)
	}
	if got, want := upNextIDs(r), "s1 s2 auto1"; got != want {
		t.Errorf("up next = %q, want %q", got, want)
	}
}

func upNextIDs(r *Room) string {
	var ids []string
	for _, it := range r.State().Queue {
		ids = append(ids, it.VideoID)
	}
	return strings.Join(ids, " ")
}

// pollingMidAdd runs the room's background poll while an add is still in
// flight, like the real app, which queues a song ~2s after the plugin answers.
type pollingMidAdd struct {
	*fakePlayer
	poll func()
}

func (p *pollingMidAdd) AddToQueue(ctx context.Context, id string, pos ytm.InsertPosition) error {
	p.poll()
	return p.fakePlayer.AddToQueue(ctx, id, pos)
}

func TestAddKeepsTheOwnerWhileTheSongIsStillLanding(t *testing.T) {
	ctx := context.Background()
	p := &pollingMidAdd{fakePlayer: newFake(ytm.Track{VideoID: "playing"})}
	r := newTestRoom(p)
	p.poll = func() { _ = r.Refresh(ctx) }
	rina := mustJoin(t, r, "Rina", false)

	// Twice: the second add, after a remove, must not inherit "already landed".
	for round := 1; round <= 2; round++ {
		if err := r.Add(ctx, rina.ID, "s1"); err != nil {
			t.Fatal(err)
		}
		if q := r.State().Queue; len(q) != 1 || q[0].AddedBy != "Rina" {
			t.Fatalf("round %d: queue = %+v", round, q)
		}
		if err := r.Remove(ctx, rina.ID, "s1"); err != nil {
			t.Fatal(err)
		}
	}
}

func mustJoin(t *testing.T, r *Room, name string, isHost bool) *Guest {
	t.Helper()
	g, err := r.Join(name, "", "", isHost)
	if err != nil {
		t.Fatalf("Join(%q): %v", name, err)
	}
	return g
}

func TestJoinTrimsAndCapsNames(t *testing.T) {
	r := newTestRoom(newFake())
	cases := []struct{ in, want string }{
		{"  Rina  ", "Rina"},
		{"", "Guest"},
		{"ÉéÉéÉéÉéÉéÉéÉéÉéÉéÉéÉéÉéXYZ", "ÉéÉéÉéÉéÉéÉéÉéÉéÉéÉéÉéÉé"}, // cut by characters, not bytes
	}
	for _, c := range cases {
		if got := mustJoin(t, r, c.in, false).Name; got != c.want {
			t.Errorf("Join(%q).Name = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestJoinRefusesATakenNameButAlwaysLetsTheHostIn(t *testing.T) {
	r := newTestRoom(newFake())
	mustJoin(t, r, "Rina", false)
	mustJoin(t, r, "Host", true)
	cases := []struct {
		in      string
		isHost  bool
		want    string
		wantErr error
	}{
		{"rina", false, "", ErrNameTaken},    // case doesn't make it a new name
		{"  Rina ", false, "", ErrNameTaken}, // nor do spaces around it
		{"Host", false, "", ErrNameTaken},    // a guest can't pass as the host
		{"Rina B", false, "Rina B", nil},     // a different name is fine
		{"Host", true, "Host 2", nil},        // the host's second device still gets in
	}
	for _, c := range cases {
		g, err := r.Join(c.in, "", "", c.isHost)
		if !errors.Is(err, c.wantErr) || (g != nil && g.Name != c.want) {
			t.Errorf("Join(%q, host=%v) = %v, %v; want %q, %v", c.in, c.isHost, g, err, c.want, c.wantErr)
		}
	}
}

func TestKickRemovesTheGuestAndFreesTheirName(t *testing.T) {
	r := newTestRoom(newFake())
	host, rina := mustJoin(t, r, "Host", true), mustJoin(t, r, "Rina", false)

	if err := r.Kick(host.ID, rina.ID); err != nil {
		t.Fatal(err)
	}
	if _, in := r.GuestBySession(rina.Session); in || !r.Kicked(rina.Session) || r.Kicked(host.Session) {
		t.Errorf("Rina's session: still in %v, removed %v (host's removed %v); want out and removed", in, r.Kicked(rina.Session), r.Kicked(host.Session))
	}
	if st := r.State(); len(st.Guests) != 1 || st.Guests[0].ID != host.ID {
		t.Errorf("guests = %+v, want only the host", st.Guests)
	}
	mustJoin(t, r, "rina", false) // no block: she can come straight back
}

func TestKickRulesWhoMayRemoveWhom(t *testing.T) {
	cases := []struct {
		name, by, whom string // names of people in the room; "" is an ID nobody has
		wantErr        error
	}{
		{"a guest can't remove anyone", "Rina", "Dimas", ErrNotHost},
		{"the host can't remove themself", "Host", "Host", ErrKickSelf},
		{"nobody has that ID", "Host", "", ErrNotFound},
		{"someone not in the room can't remove anyone", "", "Rina", ErrUnknownUser},
		{"the host removes a guest", "Host", "Rina", nil},
		{"the host removes their other device", "Host", "Host 2", nil},
	}
	for _, c := range cases {
		r := newTestRoom(newFake())
		ids := map[string]string{"": "nope"}
		for _, g := range []*Guest{mustJoin(t, r, "Host", true), mustJoin(t, r, "Host", true), mustJoin(t, r, "Rina", false), mustJoin(t, r, "Dimas", false)} {
			ids[g.Name] = g.ID
		}
		err := r.Kick(ids[c.by], ids[c.whom])
		want := 4
		if c.wantErr == nil {
			want = 3
		}
		if got := len(r.State().Guests); !errors.Is(err, c.wantErr) || got != want {
			t.Errorf("%s: err = %v with %d left; want %v with %d left", c.name, err, got, c.wantErr, want)
		}
	}
}

func TestKickDropsTheGuestsSkipVote(t *testing.T) {
	ctx := context.Background()
	r := newTestRoom(newFake(ytm.Track{VideoID: "one"}, ytm.Track{VideoID: "two"})) // 2 votes skip
	host, a, b := mustJoin(t, r, "Host", true), mustJoin(t, r, "A", false), mustJoin(t, r, "B", false)
	_ = r.Refresh(ctx)

	_, _, _ = r.VoteSkip(ctx, a.ID)
	if err := r.Kick(host.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	if votes := r.State().SkipVotes; votes != 0 {
		t.Errorf("skip votes right after the kick = %d, want 0", votes)
	}
	if votes, skipped, _ := r.VoteSkip(ctx, b.ID); votes != 1 || skipped {
		t.Errorf("B's vote: %d votes, skipped %v; want 1 vote and no skip", votes, skipped)
	}
}

func TestKickKeepsTheirSongsCreditedToSomeoneWhoLeft(t *testing.T) {
	ctx := context.Background()
	r := newTestRoom(newFake(ytm.Track{VideoID: "playing"}))
	host, rina := mustJoin(t, r, "Host", true), mustJoin(t, r, "Rina", false)
	if err := r.Add(ctx, rina.ID, "s1"); err != nil {
		t.Fatal(err)
	}

	if err := r.Kick(host.ID, rina.ID); err != nil {
		t.Fatal(err)
	}
	_ = r.Refresh(ctx)
	if q := r.State().Queue; len(q) != 1 || q[0].VideoID != "s1" || q[0].AddedByID != rina.ID || q[0].AddedBy != "someone who left" {
		t.Errorf("up next = %+v, want s1 still there, by Rina's ID, shown as someone who left", q)
	}
}

func TestAHostDeviceRemovedByAnotherCantRemoveBack(t *testing.T) {
	r := newTestRoom(newFake())
	laptop, phone := mustJoin(t, r, "Host", true), mustJoin(t, r, "Host", true)

	if err := r.Kick(laptop.ID, phone.ID); err != nil {
		t.Fatal(err)
	}
	if err := r.Kick(phone.ID, laptop.ID); !errors.Is(err, ErrUnknownUser) {
		t.Errorf("the removed device removing the other = %v, want ErrUnknownUser", err)
	}
	if _, in := r.Guest(laptop.ID); !in {
		t.Error("no host left in the room")
	}
}

func TestASongMidAddWhenItsGuestIsRemovedStillLands(t *testing.T) {
	ctx := context.Background()
	p := &pollingMidAdd{fakePlayer: newFake(ytm.Track{VideoID: "playing"})}
	r := newTestRoom(p)
	host, rina := mustJoin(t, r, "Host", true), mustJoin(t, r, "Rina", false)
	p.poll = func() { _ = r.Kick(host.ID, rina.ID) }

	// The add was past its guest check when the kick came, so it goes through.
	if err := r.Add(ctx, rina.ID, "s1"); err != nil {
		t.Fatal(err)
	}
	if q := r.State().Queue; len(q) != 1 || q[0].VideoID != "s1" || q[0].AddedByID != rina.ID {
		t.Errorf("up next = %+v, want s1 by Rina's ID", q)
	}
}

func TestKickRemembersOnlyTheLatestRemovedSessions(t *testing.T) {
	r := newTestRoom(newFake())
	host := mustJoin(t, r, "Host", true)
	var removed []string
	for i := range kickedRemembered + 1 {
		g := mustJoin(t, r, "Guest "+itoa(i), false)
		if err := r.Kick(host.ID, g.ID); err != nil {
			t.Fatal(err)
		}
		removed = append(removed, g.Session)
	}
	if r.Kicked(removed[0]) || !r.Kicked(removed[1]) || !r.Kicked(removed[kickedRemembered]) {
		t.Errorf("want the first removed session forgotten and the last %d remembered", kickedRemembered)
	}
}

func TestRateLimitAppliesToGuestsNotHost(t *testing.T) {
	ctx := context.Background()
	r := newTestRoom(newFake())
	host := mustJoin(t, r, "Host", true)
	g := mustJoin(t, r, "Dimas", false)

	for i, id := range []string{"a", "b"} {
		if err := r.Add(ctx, g.ID, id); err != nil {
			t.Fatalf("add %d: %v", i, err)
		}
	}
	if err := r.Add(ctx, g.ID, "c"); !errors.Is(err, ErrRateLimited) {
		t.Errorf("3rd add should be rate limited, got %v", err)
	}
	for _, id := range []string{"h1", "h2", "h3"} {
		if err := r.Add(ctx, host.ID, id); err != nil {
			t.Errorf("host add %s: %v", id, err)
		}
	}
}

func TestRemoveOwnershipAndIndexResolution(t *testing.T) {
	ctx := context.Background()
	p := newFake(ytm.Track{VideoID: "playing"})
	r := newTestRoom(p)
	rina := mustJoin(t, r, "Rina", false)
	dimas := mustJoin(t, r, "Dimas", false)
	host := mustJoin(t, r, "host", true)

	_ = r.Add(ctx, rina.ID, "r1")
	_ = r.Add(ctx, dimas.ID, "d1")

	if err := r.Remove(ctx, dimas.ID, "r1"); !errors.Is(err, ErrNotOwner) {
		t.Errorf("want ErrNotOwner, got %v", err)
	}
	// Autoplay inserts something ahead of r1 behind our back: index shifts.
	p.queue = append([]ytm.Track{p.queue[0], {VideoID: "radio"}}, p.queue[1:]...)

	if err := r.Remove(ctx, rina.ID, "r1"); err != nil {
		t.Fatalf("owner remove: %v", err)
	}
	for _, tr := range p.queue {
		if tr.VideoID == "r1" {
			t.Fatal("r1 still in player queue")
		}
	}
	if err := r.Remove(ctx, host.ID, "d1"); err != nil {
		t.Fatalf("host remove anything: %v", err)
	}
	if err := r.Remove(ctx, host.ID, "nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestMovePutsTheSongAtThatUpNextSlot(t *testing.T) {
	cases := []struct {
		name     string
		asHost   bool
		videoID  string
		position int
		wantErr  error
		want     []string // Up Next afterwards
	}{
		{"third song to the top", true, "c", 0, nil, []string{"c", "a", "b"}},
		{"first song to the bottom", true, "a", 2, nil, []string{"b", "c", "a"}},
		{"a slot past the end means last", true, "a", 9, nil, []string{"b", "c", "a"}},
		{"a negative slot means first", true, "c", -1, nil, []string{"c", "a", "b"}},
		{"an already-played song is not in Up Next", true, "played", 0, ErrNotFound, []string{"a", "b", "c"}},
		{"a guest can reorder too", false, "c", 0, nil, []string{"c", "a", "b"}},
	}
	for _, c := range cases {
		ctx := context.Background()
		p := newFake(ytm.Track{VideoID: "played"}, ytm.Track{VideoID: "playing"},
			ytm.Track{VideoID: "a"}, ytm.Track{VideoID: "b"}, ytm.Track{VideoID: "c"})
		p.current = 1
		r := newTestRoom(p)
		g := mustJoin(t, r, "someone", c.asHost)
		_ = r.Refresh(ctx)

		if err := r.Move(ctx, g.ID, c.videoID, c.position); !errors.Is(err, c.wantErr) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.wantErr)
			continue
		}
		st := r.State()
		var got []string
		for _, it := range st.Queue {
			got = append(got, it.VideoID)
		}
		if !slices.Equal(got, c.want) || st.NowPlaying.VideoID != "playing" {
			t.Errorf("%s: playing %q, up next %v; want playing, %v", c.name, st.NowPlaying.VideoID, got, c.want)
		}
	}
}

func TestShuffleMixesUpNextOnly(t *testing.T) {
	ctx := context.Background()
	want := []string{"a", "b", "c", "d", "e", "f"} // f is the last guest's song; e was autoplay before them
	tracks := []ytm.Track{{VideoID: "played"}, {VideoID: "playing"}}
	for _, id := range append(slices.Clone(want), "radio1", "radio2") {
		tracks = append(tracks, ytm.Track{VideoID: id})
	}
	p := newFake(tracks...)
	p.current = 1
	r := newTestRoom(p)
	guest := mustJoin(t, r, "Rina", false)
	host := mustJoin(t, r, "Dimas", true)
	for _, id := range []string{"a", "c", "f"} {
		r.owners[id] = guest.ID
	}
	_ = r.Refresh(ctx)

	if err := r.Shuffle(ctx, "nobody"); !errors.Is(err, ErrUnknownUser) {
		t.Fatalf("stranger shuffle: err = %v, want ErrUnknownUser", err)
	}
	changed := false
	for i := range 20 { // 6! orders: twenty shuffles all landing on the start is a broken shuffle
		who := []*Guest{guest, host}[i%2] // anyone in the jam may shuffle
		if err := r.Shuffle(ctx, who.ID); err != nil {
			t.Fatal(err)
		}
		st := r.State()
		var got []string
		for _, it := range st.Queue[:len(want)] {
			got = append(got, it.VideoID)
		}
		if p.queue[0].VideoID != "played" || st.NowPlaying.VideoID != "playing" ||
			p.queue[8].VideoID != "radio1" || p.queue[9].VideoID != "radio2" {
			t.Fatalf("played, playing or autoplay rows moved: %v", p.queue)
		}
		if !slices.Equal(slices.Sorted(slices.Values(got)), want) {
			t.Fatalf("up next %v is not a mix of %v", got, want)
		}
		changed = changed || !slices.Equal(got, want)
	}
	if !changed {
		t.Error("twenty shuffles never changed the order")
	}
	if last := r.State().Feed; len(last) == 0 || last[len(last)-1].Kind != FeedShuffled {
		t.Error("shuffle isn't in the feed")
	}
}

func TestAutoplayShowsOnlySongsThePlayerDoesntHave(t *testing.T) {
	cases := []struct {
		name  string
		guess []string // YouTube's suggestions, in order
		want  string   // State.Autoplay
	}{
		{"played, playing and up next songs are left out", []string{"played", "a", "playing", "next", "b"}, "a b"},
		{"a song suggested twice shows once", []string{"a", "a", "b"}, "a b"},
		{"only the first AutoplayLength show", strings.Fields("1 2 3 4 5 6 7 8 9 10 11 12"), "1 2 3 4 5 6 7 8 9 10"},
		{"no guess shows nothing", nil, ""},
	}
	for _, c := range cases {
		p := newFake(ytm.Track{VideoID: "played"}, ytm.Track{VideoID: "playing"}, ytm.Track{VideoID: "next"})
		p.current = 1
		for _, id := range c.guess {
			p.guess = append(p.guess, ytm.Track{VideoID: id})
		}
		r := newTestRoom(p)
		_ = r.Refresh(context.Background())

		var got []string
		for _, tr := range r.State().Autoplay {
			got = append(got, tr.VideoID)
		}
		if strings.Join(got, " ") != c.want {
			t.Errorf("%s: autoplay = %q, want %q", c.name, strings.Join(got, " "), c.want)
		}
	}
}

func TestVoteSkipThresholdAndReset(t *testing.T) {
	ctx := context.Background()
	p := newFake(ytm.Track{VideoID: "one"}, ytm.Track{VideoID: "two"})
	r := newTestRoom(p)
	a := mustJoin(t, r, "A", false)
	b := mustJoin(t, r, "B", false)
	_ = r.Refresh(ctx)

	if _, skipped, _ := r.VoteSkip(ctx, a.ID); skipped {
		t.Fatal("one vote should not skip")
	}
	if _, skipped, _ := r.VoteSkip(ctx, a.ID); skipped {
		t.Fatal("same guest voting twice should not count twice")
	}
	votes, skipped, err := r.VoteSkip(ctx, b.ID)
	if err != nil || !skipped || votes != 2 {
		t.Fatalf("votes=%d skipped=%v err=%v", votes, skipped, err)
	}
	if st := r.State(); st.NowPlaying == nil || st.NowPlaying.VideoID != "two" || st.SkipVotes != 0 {
		t.Fatalf("after skip: %+v", st.NowPlaying)
	}
}

func TestSubscribeGetsSnapshots(t *testing.T) {
	r := newTestRoom(newFake())
	ch, cancel := r.Subscribe()
	defer cancel()
	<-ch // initial
	mustJoin(t, r, "X", false)
	select {
	case st := <-ch:
		if len(st.Guests) != 1 {
			t.Fatalf("guests = %+v", st.Guests)
		}
	case <-time.After(time.Second):
		t.Fatal("no snapshot after join")
	}
}

func TestPlaylistRefusesWhatCantBeAPlaylistID(t *testing.T) {
	r := newTestRoom(newFake())
	for _, id := range []string{"", "x", "../../oops", "PL with spaces", strings.Repeat("a", 65)} {
		if _, err := r.Playlist(context.Background(), id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Playlist(%q) = %v, want ErrNotFound", id, err)
		}
	}
	if page, err := r.Playlist(context.Background(), "PLl578ZPbYIlFcSxuka8Km37VgbUYUWI5p"); err != nil || page.Title == "" {
		t.Errorf("a real-looking ID: %+v, %v; want the player asked", page, err)
	}
}

func TestArtistOpensOnlyChannelIDsThatAreArtists(t *testing.T) {
	const tulus = "UC_DHlXllTSMB8pTC38_leFg"
	f := newFake()
	f.artists = map[string]ytm.ArtistPage{tulus: {Artist: ytm.Artist{ID: tulus, Name: "Tulus"}}}
	r := New("TEST", "test jam", f, DefaultRules, nil)
	cases := []struct {
		name, id string
		want     error
	}{
		{"an artist", tulus, nil},
		{"a channel that isn't an artist", "UCxxxxxxxxxxxxxxxxxxxxxx", ErrNotFound},
		{"a playlist id", "VLPLl578ZPbYIlFcSxuka8Km37VgbUYUWI5p", ErrNotFound},
		{"not an id at all", "../home", ErrNotFound},
	}
	for _, c := range cases {
		if _, err := r.Artist(context.Background(), c.id); !errors.Is(err, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, err, c.want)
		}
	}
}

func TestAlbumOpensOnlyBrowseIDsThatAreAlbums(t *testing.T) {
	const abbeyRoad = "MPREb_LQwx7Jq6u9H"
	f := newFake()
	f.albums = map[string]ytm.AlbumPage{abbeyRoad: {Album: ytm.Album{ID: abbeyRoad, Title: "Abbey Road (2019 Mix)"}}}
	r := New("TEST", "test jam", f, DefaultRules, nil)
	cases := []struct {
		name, id string
		want     error
	}{
		{"an album", abbeyRoad, nil},
		{"a browse ID YouTube has no album for", "MPREb_LQwx7Jq6u9X", ErrNotFound},
		{"an artist's channel", "UC_DHlXllTSMB8pTC38_leFg", ErrNotFound},
		{"not an id at all", "MPREb_../home", ErrNotFound},
	}
	for _, c := range cases {
		if _, err := r.Album(context.Background(), c.id); !errors.Is(err, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, err, c.want)
		}
	}
}

func TestFindTrackIsNotFoundWhenYouTubeDoesntKnowIt(t *testing.T) {
	r := New("TEST", "test jam", newFake(ytm.Track{VideoID: "BSTsnWoslP4", Title: "Bohemian Rhapsody"}), DefaultRules, nil)
	if got, err := r.FindTrack(context.Background(), "BSTsnWoslP4"); err != nil || got.Title != "Bohemian Rhapsody" {
		t.Errorf("a known video: %+v, %v", got, err)
	}
	if _, err := r.FindTrack(context.Background(), "aaaaaaaaaaa"); !errors.Is(err, ErrNotFound) {
		t.Errorf("an unknown video: %v, want ErrNotFound", err)
	}
}

func TestNowPlayingTakesItsArtistLinkFromTheQueueRow(t *testing.T) {
	f := newFake(ytm.Track{VideoID: "v1", Title: "One", Artist: "Tulus", ArtistID: "UC_DHlXllTSMB8pTC38_leFg"})
	r := New("TEST", "test jam", f, DefaultRules, nil)
	if err := r.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := r.State().NowPlaying; got == nil || got.ArtistID != "UC_DHlXllTSMB8pTC38_leFg" {
		t.Errorf("now playing %+v, want the queue row's artist link", got)
	}
}

func TestSuggestWaitsForTwoCharacters(t *testing.T) {
	r := New("TEST", "test jam", newFake(), DefaultRules, nil)
	if got := r.Suggest(context.Background(), " t "); got != nil {
		t.Errorf("one character got %v, want nothing", got)
	}
	if got := r.Suggest(context.Background(), "tul"); len(got) != 1 {
		t.Errorf("three characters got %v, want the player's suggestions", got)
	}
}
