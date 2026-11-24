package room

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"log/slog"
	mrand "math/rand/v2"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dezeto/nimbrung/internal/ytm"
)

// Room is one jam session. Create it with New, run Refresh in a loop (see
// Run), and call the guest/host methods from HTTP handlers.
type Room struct {
	code   string
	name   string
	player ytm.Player
	log    *slog.Logger
	now    func() time.Time

	mu        sync.Mutex
	rules     Rules
	guests    map[string]*Guest
	waiting   map[string]*Guest // guest ID -> asked to join, not let in yet; see LetIn
	owners    map[string]string // videoID -> guest ID who added it
	landed    map[string]bool   // videoID -> seen in the player's queue since it was added
	placing   map[string]bool   // videoID -> added, not yet moved to its slot; hidden from Up Next
	skipVotes map[string]bool   // guest ID -> voted for the current song
	nudges    map[string]nudge  // guest ID -> their latest volume nudge; see NudgeVolume
	kicked    []string          // sessions the host removed, oldest first; see Kick
	blocked   []Blocked         // networks the host blocked, oldest first; see Block
	limiter   *limiter
	joins     *limiter // per IP; see Join
	guesses   *limiter // wrong join codes per IP; see CheckCode
	state     State    // last snapshot, rebuilt by Refresh
	subs      map[chan State]struct{}
	live      liveShow // reactions and comments; see live.go
	savePath  string   // where the jam is saved between restarts; "" = nowhere. See Persist
	lastSaved []byte   // what's in the file, to skip writing an unchanged jam
	history   []Played // what played tonight, oldest first; see Recap
}

// New creates a room. hostName is shown to guests ("<hostName>'s jam").
func New(code, name string, player ytm.Player, rules Rules, log *slog.Logger) *Room {
	if log == nil {
		log = slog.Default()
	}
	r := &Room{
		code:      code,
		name:      name,
		player:    player,
		log:       log,
		now:       time.Now,
		rules:     rules,
		guests:    map[string]*Guest{},
		waiting:   map[string]*Guest{},
		owners:    map[string]string{},
		landed:    map[string]bool{},
		placing:   map[string]bool{},
		skipVotes: map[string]bool{},
		nudges:    map[string]nudge{},
		limiter:   newLimiter(rules.MaxAddsPerMinute, time.Minute),
		joins:     newLimiter(joinsPerNetwork, joinWindow),
		guesses:   newLimiter(codeGuessesPerNetwork, joinWindow),
		subs:      map[chan State]struct{}{},
		live:      newLiveShow(),
	}
	r.state = State{Name: name, Rules: rules}
	return r
}

// Code returns the join code.
func (r *Room) Code() string { return r.code }

// codeGuessesPerNetwork wrong codes per joinWindow from one IP. A 4-character
// code is under a million guesses, which the public link would let anyone
// run through in minutes. Guests scan the QR, so a typed wrong code is rare.
const codeGuessesPerNetwork = 10

// CheckCode reports whether code is the join code, counting a wrong one
// against ip ("" if unknown, never counted, like Join). Past the limit the
// network gets ErrManyGuesses even for the right code, or the guesser would
// just keep going until one lands.
// ponytail: per IP, so a guesser with many addresses still gets through;
// start with a longer -code if the public link is shared widely.
func (r *Room) CheckCode(code, ip string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if ip != "" && r.guesses.remaining(ip, r.now()) == 0 {
		return ErrManyGuesses
	}
	if strings.EqualFold(strings.TrimSpace(code), r.code) {
		return nil
	}
	if ip != "" {
		r.guesses.allow(ip, r.now())
	}
	return ErrWrongCode
}

// --- membership ---------------------------------------------------------

// MaxNameLength caps nicknames, in characters, so one guest can't blow out
// every queue row and the host's guest list.
const MaxNameLength = 24

// joinsPerNetwork joins per joinWindow from one IP, so one visitor can't
// take many names to get round MaxAddsPerMinute or to outvote a skip.
// Generous on purpose: behind the public link every phone on the host's
// Wi-Fi, or on one mobile carrier's NAT, arrives from the same address, and
// a party of 30 turning up at once, some joining twice, must never see it.
const (
	joinsPerNetwork = 60
	joinWindow      = 10 * time.Minute
)

// kickedRemembered bounds how many removed sessions the room keeps answering
// ErrKicked for. Past that the oldest just gets "join the room first", as
// after a restart.
const kickedRemembered = 100

// Join adds a guest and returns it. avatar is one of Avatars; "" or one
// someone here already has picks a free one for the host, while a guest is
// told to pick again (ErrAvatarTaken), unless all are taken. Names are trimmed and cut to
// MaxNameLength, and a guest can't take a name someone here already has
// (ignoring case), so "added by" is never ambiguous. The host always gets in,
// numbered on a clash ("Host 2") or from a blocked ip, so a second device
// can't lock them out. ip is where the guest joins from, "" if unknown; past
// joinsPerNetwork from one ip in joinWindow, guests get ErrManyJoins.
// While the rules say AskToJoin, a guest comes back Waiting: kept out of the
// jam, name held, until the host lets them in.
func (r *Room) Join(name, avatar, ip string, isHost bool) (*Guest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !isHost && r.blockedLocked(ip) {
		return nil, ErrBlocked
	}

	name = strings.TrimSpace(name)
	if runes := []rune(name); len(runes) > MaxNameLength {
		name = strings.TrimSpace(string(runes[:MaxNameLength]))
	}
	if name == "" {
		name = "Guest"
	}
	if r.nameTakenLocked(name) {
		if !isHost {
			return nil, ErrNameTaken
		}
		name = r.uniqueNameLocked(name)
	}
	if !slices.Contains(Avatars, avatar) {
		avatar = ""
	}
	if avatar != "" && r.avatarTakenLocked(avatar) && r.freeAvatarLocked() != "" {
		if !isHost {
			return nil, ErrAvatarTaken
		}
		avatar = ""
	}
	if avatar == "" {
		avatar = r.freeAvatarLocked()
	}
	if avatar == "" { // everyone's taken: faces repeat
		avatar = Avatars[len(r.guests)%len(Avatars)]
	}
	// Last, so a name or face clash doesn't use up the network's joins. The
	// host's own computer ("") brings in everyone the tunnel does, so it
	// isn't counted, like Block.
	if !isHost && ip != "" && !r.joins.allow(ip, r.now()) {
		return nil, ErrManyJoins
	}
	g := &Guest{ID: newID(), Session: newSession(), Name: name, Avatar: avatar, IP: ip, IsHost: isHost, JoinedAt: r.now()}
	if r.rules.AskToJoin && !isHost {
		g.Waiting = true
		r.waiting[g.ID] = g
	} else {
		r.guests[g.ID] = g
	}
	r.state.Guests, r.state.Waiting = r.guestListLocked(), r.waitingListLocked()
	r.broadcastLocked()
	cp := *g
	return &cp, nil
}

// Leave removes a guest. Their queued songs stay (attribution is kept).
func (r *Room) Leave(guestID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.guests, guestID)
	delete(r.waiting, guestID)
	delete(r.skipVotes, guestID)
	delete(r.nudges, guestID)
	r.state.Guests, r.state.Waiting = r.guestListLocked(), r.waitingListLocked()
	r.state.Nudges = r.nudgesLocked()
	r.broadcastLocked()
}

// Kick removes a guest at the host's request. Like Leave, their queued songs
// stay. Unlike Leave, the room remembers their session, so every tab they
// have open hears they were removed (see Kicked) instead of being asked to
// join. One lock covers the host check and the delete: checking first and
// deleting after would let two host devices each remove the other.
func (r *Room) Kick(hostID, guestID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.kickableLocked(hostID, guestID); err != nil {
		return err
	}
	r.kickLocked(guestID)
	r.broadcastLocked()
	return nil
}

// kickableLocked returns the guest the host may remove, in the jam or
// waiting to join (turned away), or why not.
func (r *Room) kickableLocked(hostID, guestID string) (*Guest, error) {
	if err := r.hostOnlyLocked(hostID); err != nil {
		return nil, err
	}
	if guestID == hostID {
		return nil, ErrKickSelf
	}
	if g, ok := r.guests[guestID]; ok {
		return g, nil
	}
	if g, ok := r.waiting[guestID]; ok {
		return g, nil
	}
	return nil, ErrNotFound
}

// kickLocked removes a guest kickableLocked allowed; the caller broadcasts.
// Turning away someone still waiting isn't news for the feed.
func (r *Room) kickLocked(guestID string) {
	g, in := r.guests[guestID]
	if !in {
		g = r.waiting[guestID]
	}
	delete(r.guests, guestID)
	delete(r.waiting, guestID)
	delete(r.skipVotes, guestID)
	delete(r.nudges, guestID)
	r.state.Nudges = r.nudgesLocked()
	r.kicked = append(r.kicked[max(0, len(r.kicked)-kickedRemembered+1):], g.Session)
	r.state.SkipVotes = len(r.skipVotes)
	r.state.Guests, r.state.Waiting = r.guestListLocked(), r.waitingListLocked()
	if in {
		r.recordLocked(FeedEntry{Kind: FeedKicked, GuestID: g.ID, Name: g.Name})
	}
}

// Guest looks up a guest by ID.
func (r *Room) Guest(id string) (*Guest, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	g, ok := r.guests[id]
	if !ok {
		return nil, false
	}
	cp := *g
	return &cp, true
}

// GuestBySession finds the guest whose cookie carries session, in the jam or
// Waiting. The compare is constant-time so response timing doesn't hint at a
// valid session.
func (r *Room) GuestBySession(session string) (*Guest, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, guests := range []map[string]*Guest{r.guests, r.waiting} {
		for _, g := range guests {
			if subtle.ConstantTimeCompare([]byte(g.Session), []byte(session)) == 1 {
				cp := *g
				return &cp, true
			}
		}
	}
	return nil, false
}

// Kicked says whether session belonged to a guest the host removed. A plain
// lookup, not constant-time like GuestBySession: a removed session opens
// nothing, and its answer says it was removed anyway.
func (r *Room) Kicked(session string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Contains(r.kicked, session)
}

// nameTakenLocked counts names waiting too, so letting someone in never
// makes a clash.
func (r *Room) nameTakenLocked(name string) bool {
	for _, guests := range []map[string]*Guest{r.guests, r.waiting} {
		for _, g := range guests {
			if strings.EqualFold(g.Name, name) {
				return true
			}
		}
	}
	return false
}

func (r *Room) uniqueNameLocked(base string) string {
	name := base
	for i := 2; r.nameTakenLocked(name); i++ {
		name = base + " " + itoa(i)
	}
	return name
}

// --- guest actions ------------------------------------------------------

// Search proxies a search to the player. No rules apply.
func (r *Room) Search(ctx context.Context, req ytm.SearchRequest) (ytm.SearchPage, error) {
	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" {
		return ytm.SearchPage{}, nil
	}
	return r.player.Search(ctx, req)
}

// playlistIDs is what YouTube playlist IDs are made of; nothing else can be one.
var playlistIDs = regexp.MustCompile(`^[A-Za-z0-9_-]{2,64}$`)

// Playlist opens a playlist from search results, to pick songs from. Its
// songs are added one by one like any others, so the house rules hold.
func (r *Room) Playlist(ctx context.Context, id string) (ytm.PlaylistPage, error) {
	if !playlistIDs.MatchString(id) {
		return ytm.PlaylistPage{}, ErrNotFound
	}
	return r.player.Playlist(ctx, id)
}

// artistIDs is the shape of a YouTube channel ID, which is what an artist is.
var artistIDs = regexp.MustCompile(`^UC[A-Za-z0-9_-]{10,62}$`)

// Artist opens an artist from search results or a song's byline, to pick
// from their songs.
func (r *Room) Artist(ctx context.Context, id string) (ytm.ArtistPage, error) {
	if !artistIDs.MatchString(id) {
		return ytm.ArtistPage{}, ErrNotFound
	}
	page, err := r.player.Artist(ctx, id)
	if err == nil && page.Name == "" {
		return ytm.ArtistPage{}, ErrNotFound
	}
	return page, err
}

// albumIDs is the shape of YouTube's album browse IDs.
var albumIDs = regexp.MustCompile(`^MPREb_[A-Za-z0-9_-]{5,40}$`)

// Album opens an album from search results or an artist's page, to pick
// from its songs.
func (r *Room) Album(ctx context.Context, id string) (ytm.AlbumPage, error) {
	if !albumIDs.MatchString(id) {
		return ytm.AlbumPage{}, ErrNotFound
	}
	page, err := r.player.Album(ctx, id)
	if err == nil && page.Title == "" {
		return ytm.AlbumPage{}, ErrNotFound
	}
	return page, err
}

// FindTrack tells a guest what the link they pasted is before they add it.
func (r *Room) FindTrack(ctx context.Context, videoID string) (ytm.Track, error) {
	track, err := r.player.FindTrack(ctx, videoID)
	if err == nil && track.VideoID == "" {
		return ytm.Track{}, ErrNotFound
	}
	return track, err
}

// Radio is songs like videoID (the one playing), for the search screen's
// "More like what's playing". Empty when YouTube has none.
func (r *Room) Radio(ctx context.Context, videoID string) []ytm.Track {
	return r.player.Radio(ctx, videoID)
}

// minSuggestInput is how much a guest types before suggestions mean anything.
const minSuggestInput = 2

// Suggest returns ways to finish what a guest has typed so far.
func (r *Room) Suggest(ctx context.Context, input string) []string {
	input = strings.TrimSpace(input)
	if len(input) < minSuggestInput {
		return nil
	}
	return r.player.Suggest(ctx, input)
}

// Add queues a song on behalf of a guest, enforcing rate limit and dedupe.
func (r *Room) Add(ctx context.Context, guestID, videoID string) error {
	r.mu.Lock()
	g, ok := r.guests[guestID]
	if !ok {
		r.mu.Unlock()
		return ErrUnknownUser
	}
	if r.isQueuedLocked(videoID) {
		r.mu.Unlock()
		return ErrDuplicate
	}
	if !g.IsHost && !r.limiter.allow(guestID, r.now()) {
		r.mu.Unlock()
		return ErrRateLimited
	}
	// Claim ownership before the call so the next Refresh attributes it even
	// if the poll races the add.
	r.owners[videoID] = guestID
	r.placing[videoID] = true
	g.Adds++
	r.mu.Unlock()

	// Not INSERT_AT_END: the app drops those on radio queues (see
	// ytm.ErrNotQueued), and the end is behind every autoplay row anyway.
	if err := r.player.AddToQueue(ctx, videoID, ytm.InsertAfterCurrentVideo); err != nil {
		r.mu.Lock()
		delete(r.owners, videoID)
		delete(r.placing, videoID)
		g.Adds--
		r.mu.Unlock()
		return err
	}
	if err := r.moveBehindGuestSongs(ctx, videoID); err != nil {
		r.log.Warn("song queued but left right after the current one", "videoId", videoID, "err", err)
	}
	// Only now may Up Next show it: before the move a poll would show it right
	// after the current song, then see it jump down behind the guests' songs.
	r.mu.Lock()
	delete(r.placing, videoID)
	r.mu.Unlock()
	return r.Refresh(ctx)
}

// moveBehindGuestSongs moves a song that was just added after the current one
// to right behind the last song a guest added, so picks play in the order
// they came in, ahead of autoplay.
func (r *Room) moveBehindGuestSongs(ctx context.Context, videoID string) error {
	queue, err := r.player.Queue(ctx)
	if err != nil {
		return err
	}
	cur := slices.IndexFunc(queue, func(q ytm.QueueItem) bool { return q.Selected })
	if cur < 0 || cur+1 >= len(queue) || queue[cur+1].VideoID != videoID {
		return nil
	}
	from, to := queue[cur+1].Index, -1
	r.mu.Lock()
	for _, q := range queue[cur+2:] {
		if r.owners[q.VideoID] != "" {
			to = q.Index
		}
	}
	r.mu.Unlock()
	if to < 0 {
		return nil
	}
	// The app takes the row out first, so landing at the last guest song's
	// old index puts it right behind that song.
	return r.player.MoveInQueue(ctx, from, to)
}

// Remove takes a song out of the queue. Guests may only remove their own;
// the host may remove anything. The index is resolved fresh from the player
// right before deleting because the queue shifts under us.
func (r *Room) Remove(ctx context.Context, guestID, videoID string) error {
	r.mu.Lock()
	g, ok := r.guests[guestID]
	if !ok {
		r.mu.Unlock()
		return ErrUnknownUser
	}
	owner := r.owners[videoID]
	r.mu.Unlock()

	if !g.IsHost && owner != guestID {
		return ErrNotOwner
	}

	queue, err := r.player.Queue(ctx)
	if err != nil {
		return err
	}
	idx, title := -1, ""
	for _, it := range queue {
		if it.VideoID == videoID && !it.Selected {
			idx, title = it.Index, it.Title
			break
		}
	}
	if idx < 0 {
		return ErrNotFound
	}
	if err := r.player.RemoveFromQueue(ctx, idx); err != nil {
		return err
	}
	r.mu.Lock()
	delete(r.owners, videoID)
	delete(r.landed, videoID)
	r.recordLocked(FeedEntry{Kind: FeedRemoved, GuestID: g.ID, Name: g.Name, Title: title})
	r.mu.Unlock()
	return r.Refresh(ctx)
}

// VoteSkip records a skip vote; when the threshold is reached the song is
// skipped. The host's vote always skips immediately.
func (r *Room) VoteSkip(ctx context.Context, guestID string) (votes int, skipped bool, err error) {
	r.mu.Lock()
	g, ok := r.guests[guestID]
	if !ok {
		r.mu.Unlock()
		return 0, false, ErrUnknownUser
	}
	r.skipVotes[guestID] = true
	votes = len(r.skipVotes)
	need := r.rules.SkipVotesNeeded
	r.state.SkipVotes = votes
	entry := skipEntry(g, r.state.NowPlaying, votes)
	r.mu.Unlock()

	if g.IsHost || (need > 0 && votes >= need) {
		if err := r.player.Next(ctx); err != nil {
			return votes, false, err
		}
		r.mu.Lock()
		r.skipVotes = map[string]bool{}
		r.state.SkipVotes = 0
		r.recordLocked(entry)
		r.mu.Unlock()
		return votes, true, r.Refresh(ctx)
	}
	r.mu.Lock()
	r.broadcastLocked()
	r.mu.Unlock()
	return votes, false, nil
}

// AddsRemaining tells a guest how many adds they have left this minute.
func (r *Room) AddsRemaining(guestID string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	if g, ok := r.guests[guestID]; ok && g.IsHost {
		return 1 << 30
	}
	return r.limiter.remaining(guestID, r.now())
}

// --- host actions -------------------------------------------------------

func (r *Room) hostOnly(guestID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.hostOnlyLocked(guestID)
}

func (r *Room) hostOnlyLocked(guestID string) error {
	g, ok := r.guests[guestID]
	if !ok {
		return ErrUnknownUser
	}
	if !g.IsHost {
		return ErrNotHost
	}
	return nil
}

// Play / Pause / Skip are host-only transport controls.
func (r *Room) Play(ctx context.Context, guestID string) error {
	if err := r.hostOnly(guestID); err != nil {
		return err
	}
	if err := r.player.Play(ctx); err != nil {
		return err
	}
	return r.Refresh(ctx)
}

func (r *Room) Pause(ctx context.Context, guestID string) error {
	if err := r.hostOnly(guestID); err != nil {
		return err
	}
	if err := r.player.Pause(ctx); err != nil {
		return err
	}
	return r.Refresh(ctx)
}

// Seek jumps the playing song to seconds in, for a tapped lyric line. Host
// only, like pause: it moves the song for the whole room.
func (r *Room) Seek(ctx context.Context, guestID string, seconds float64) error {
	if err := r.hostOnly(guestID); err != nil {
		return err
	}
	if err := r.player.Seek(ctx, max(seconds, 0)); err != nil {
		return err
	}
	return r.Refresh(ctx)
}

// Move puts a song at position (0-based) in Up Next. Any guest may reorder
// any song, not just the host: it's a party, and the host can always fix
// the order. Both indexes are resolved fresh from the player right before
// moving because the queue shifts under us. position is clamped to Up Next
// so a stray value can't push a song up among the already-played rows.
func (r *Room) Move(ctx context.Context, guestID, videoID string, position int) error {
	g, ok := r.Guest(guestID)
	if !ok {
		return ErrUnknownUser
	}

	queue, err := r.player.Queue(ctx)
	if err != nil {
		return err
	}
	current, from, title := -1, -1, ""
	for _, it := range queue {
		if it.Selected {
			current = it.Index
		} else if current >= 0 && it.VideoID == videoID {
			from, title = it.Index, it.Title
			break
		}
	}
	if from < 0 {
		return ErrNotFound
	}
	to := min(current+1+max(position, 0), queue[len(queue)-1].Index)
	if err := r.player.MoveInQueue(ctx, from, to); err != nil {
		return err
	}
	r.mu.Lock()
	// The song ends up at index to, which is slot to-current counting from 1.
	r.recordLocked(FeedEntry{Kind: FeedMoved, GuestID: g.ID, Name: g.Name, Title: title, Position: to - current})
	r.mu.Unlock()
	return r.Refresh(ctx)
}

// Shuffle mixes up Up Next once. Any guest may, like Move: it's a party, the
// chat says who did it, and the host can fix the order. The song playing, the ones
// already played and the autoplay rows after the last guest's song stay put
// (the web's splitQueue draws the same line), and every song keeps who added
// it. It's a
// Fisher-Yates done as player moves, picking slot i's song from the rest.
// ponytail: indexes come from one queue read, so an add landing mid-shuffle
// can leave that one song out of the mix; re-read per move if that bites.
func (r *Room) Shuffle(ctx context.Context, guestID string) error {
	g, ok := r.Guest(guestID)
	if !ok {
		return ErrUnknownUser
	}
	queue, err := r.player.Queue(ctx)
	if err != nil {
		return err
	}
	first := slices.IndexFunc(queue, func(q ytm.QueueItem) bool { return q.Selected }) + 1
	if first == 0 {
		return ErrNotFound // nothing playing, so no Up Next
	}
	var ids []string
	r.mu.Lock()
	for i, q := range queue[first:] {
		if _, ok := r.owners[q.VideoID]; ok {
			for _, row := range queue[first+len(ids) : first+i+1] {
				ids = append(ids, row.VideoID)
			}
		}
	}
	r.mu.Unlock()
	if len(ids) < 2 {
		return nil
	}
	for i := range ids {
		j := i + mrand.IntN(len(ids)-i)
		if j == i {
			continue
		}
		if err := r.player.MoveInQueue(ctx, queue[first+j].Index, queue[first+i].Index); err != nil {
			return err
		}
		ids = slices.Insert(slices.Delete(ids, j, j+1), i, ids[j])
	}
	r.mu.Lock()
	r.recordLocked(FeedEntry{Kind: FeedShuffled, GuestID: g.ID, Name: g.Name})
	r.mu.Unlock()
	return r.Refresh(ctx)
}

// SetRules updates the house rules (host only).
// Turning AskToJoin off lets everyone waiting in.
func (r *Room) SetRules(guestID string, rules Rules) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.hostOnlyLocked(guestID); err != nil {
		return err
	}
	if !rules.AskToJoin {
		for id := range r.waiting {
			r.letInLocked(id)
		}
	}
	r.rules = rules
	r.limiter = newLimiter(rules.MaxAddsPerMinute, time.Minute)
	r.state.Rules = rules
	r.broadcastLocked()
	return nil
}

// --- sync with the player -----------------------------------------------

// Run polls the player every interval until ctx is done. Changes are
// broadcast to subscribers.
func (r *Room) Run(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if err := r.Refresh(ctx); err != nil && !errors.Is(err, context.Canceled) {
			r.log.Warn("refresh failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Refresh pulls now-playing and the queue from the player, rebuilds the
// snapshot with attribution and broadcasts it. A player error is recorded
// in State.Player rather than wiping the last good snapshot.
func (r *Room) Refresh(ctx context.Context) error {
	np, err := r.player.NowPlaying(ctx)
	if err != nil {
		r.setPlayerError(err)
		return err
	}
	queue, err := r.player.Queue(ctx)
	if err != nil {
		r.setPlayerError(err)
		return err
	}
	autoplay := autoplayAfter(r.player.Autoplay(ctx), queue, np)
	// Volume is a nicety: if the player can't say, keep the last answer.
	volume, volumeErr := r.player.Volume(ctx)

	r.mu.Lock()
	defer r.mu.Unlock()

	// New song started → reset skip votes.
	prevID := ""
	if r.state.NowPlaying != nil {
		prevID = r.state.NowPlaying.VideoID
	}
	if np == nil || np.VideoID != prevID {
		r.skipVotes = map[string]bool{}
	}

	items := make([]Item, 0, len(queue))
	seenCurrent := false
	for _, q := range queue {
		if q.Selected {
			seenCurrent = true
			// The plugin's now-playing has no link to the artist; the queue row does.
			if np != nil && np.VideoID == q.VideoID {
				np.ArtistID = q.ArtistID
			}
			continue // "up next" starts after the current song
		}
		if !seenCurrent {
			continue // already-played rows above the current one
		}
		if r.placing[q.VideoID] {
			continue // shows up once Add has put it in its slot
		}
		it := Item{Track: q.Track, Index: q.Index}
		if owner, ok := r.owners[q.VideoID]; ok {
			it.AddedByID = owner
			it.AddedBy = r.guestNameLocked(owner)
			it.AddedByAvatar = r.avatarOfLocked(owner)
		}
		items = append(items, it)
	}
	// Drop ownership records for songs that have left the queue. A song still
	// on its way in (the app queues it ~2s after the plugin answers) hasn't
	// landed yet, so it keeps its owner.
	live := map[string]bool{}
	for _, q := range queue {
		live[q.VideoID] = true
		// A guest's add goes in the feed when the song lands, not when Add
		// returns: only the queue knows its title, and a dropped add never lands.
		if owner, ok := r.owners[q.VideoID]; ok && !r.landed[q.VideoID] {
			r.landed[q.VideoID] = true
			r.recordLocked(FeedEntry{Kind: FeedAdded, GuestID: owner, Name: r.guestNameLocked(owner), Title: q.Title})
		}
	}
	for id := range r.owners {
		if live[id] {
			r.landed[id] = true
		} else if r.landed[id] {
			delete(r.owners, id)
			delete(r.landed, id)
		}
	}

	var current *NowPlaying
	if np != nil {
		current = &NowPlaying{NowPlaying: *np}
		if owner, ok := r.owners[np.VideoID]; ok {
			current.AddedByID = owner
			current.AddedBy = r.guestNameLocked(owner)
			current.AddedByAvatar = r.avatarOfLocked(owner)
		}
	}
	r.notePlayedLocked(current)

	r.state.NowPlaying = current
	r.state.Queue = items
	r.state.Autoplay = autoplay
	if volumeErr == nil {
		r.state.Volume = volume
	}
	r.state.Nudges = r.nudgesLocked()
	r.state.SkipVotes = len(r.skipVotes)
	r.state.Guests = r.guestListLocked()
	r.state.Player = PlayerStatus{Connected: true}
	r.state.UpdatedAt = r.now()
	r.saveLocked()
	r.broadcastLocked()
	return nil
}

// AutoplayLength caps State.Autoplay: it hints where the music goes, and
// YouTube's guess gets less likely the further it reaches.
const AutoplayLength = 10

// autoplayAfter is the start of YouTube's guess, minus songs the player
// already has (played, playing or up next). Now-playing counts as well as the
// queue: they're two calls, and disagree for a moment when a song changes.
func autoplayAfter(guess []ytm.Track, queue []ytm.QueueItem, np *ytm.NowPlaying) []ytm.Track {
	have := map[string]bool{}
	for _, q := range queue {
		have[q.VideoID] = true
	}
	if np != nil {
		have[np.VideoID] = true
	}
	var out []ytm.Track
	for _, t := range guess {
		if len(out) == AutoplayLength {
			break
		}
		if !have[t.VideoID] {
			have[t.VideoID] = true // YouTube may suggest a song twice
			out = append(out, t)
		}
	}
	return out
}

func (r *Room) setPlayerError(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.state.Player = PlayerStatus{Connected: false, Error: err.Error()}
	r.state.UpdatedAt = r.now()
	r.broadcastLocked()
}

// Track finds a song that's playing or queued, by video ID.
func (r *Room) Track(videoID string) (ytm.Track, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if np := r.state.NowPlaying; np != nil && np.VideoID == videoID {
		return np.Track, true
	}
	for _, it := range r.state.Queue {
		if it.VideoID == videoID {
			return it.Track, true
		}
	}
	return ytm.Track{}, false
}

// State returns a copy of the latest snapshot.
func (r *Room) State() State {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.state
}

// Subscribe returns a channel that receives every new snapshot. Slow
// subscribers drop intermediate snapshots rather than block the room.
func (r *Room) Subscribe() (<-chan State, func()) {
	ch := make(chan State, 1)
	r.mu.Lock()
	r.subs[ch] = struct{}{}
	ch <- r.state
	r.mu.Unlock()
	return ch, func() {
		r.mu.Lock()
		delete(r.subs, ch)
		r.mu.Unlock()
	}
}

func (r *Room) broadcastLocked() {
	for ch := range r.subs {
		select {
		case ch <- r.state:
		default:
			// Replace the stale pending snapshot with the newest one.
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- r.state:
			default:
			}
		}
	}
}

func (r *Room) isQueuedLocked(videoID string) bool {
	if r.placing[videoID] || r.state.NowPlaying != nil && r.state.NowPlaying.VideoID == videoID {
		return true
	}
	for _, it := range r.state.Queue {
		if it.VideoID == videoID {
			return true
		}
	}
	return false
}

func (r *Room) guestNameLocked(id string) string {
	if g, ok := r.guests[id]; ok {
		return g.Name
	}
	return "someone who left"
}

// avatarOfLocked is a guest's avatar, "" once they've left.
func (r *Room) avatarOfLocked(id string) string {
	if g, ok := r.guests[id]; ok {
		return g.Avatar
	}
	return ""
}

func (r *Room) guestListLocked() []Guest { return sortedGuests(r.guests) }

// waitingListLocked is who's waiting, longest first.
func (r *Room) waitingListLocked() []Guest { return sortedGuests(r.waiting) }

// sortedGuests lists the host first, then by who came first.
func sortedGuests(guests map[string]*Guest) []Guest {
	out := make([]Guest, 0, len(guests))
	for _, g := range guests {
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsHost != out[j].IsHost {
			return out[i].IsHost
		}
		return out[i].JoinedAt.Before(out[j].JoinedAt)
	})
	return out
}

// --- small utilities ----------------------------------------------------

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// newSession returns a guest's cookie secret: longer than an ID, and never
// broadcast, because IDs are public (every screen sees who added what).
func newSession() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// NewCode returns a 4-character join code without easily confused letters.
func NewCode() string {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}
