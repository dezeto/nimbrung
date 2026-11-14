package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dezeto/nimbrung/internal/room"
	"github.com/dezeto/nimbrung/internal/ytm"
)

// idlePlayer has nothing playing; these tests stop at the HTTP rules before
// anything would reach the player.
type idlePlayer struct{}

func (idlePlayer) NowPlaying(context.Context) (*ytm.NowPlaying, error)          { return nil, nil }
func (idlePlayer) Queue(context.Context) ([]ytm.QueueItem, error)               { return nil, nil }
func (idlePlayer) Autoplay(context.Context) []ytm.Track                         { return nil }
func (idlePlayer) AddToQueue(context.Context, string, ytm.InsertPosition) error { return nil }
func (idlePlayer) RemoveFromQueue(context.Context, int) error                   { return nil }
func (idlePlayer) MoveInQueue(context.Context, int, int) error                  { return nil }
func (idlePlayer) Next(context.Context) error                                   { return nil }
func (idlePlayer) Play(context.Context) error                                   { return nil }
func (idlePlayer) Pause(context.Context) error                                  { return nil }
func (idlePlayer) Volume(context.Context) (ytm.Volume, error)                   { return ytm.Volume{}, nil }
func (idlePlayer) SetVolume(context.Context, int) error                         { return nil }
func (idlePlayer) SetMuted(context.Context, bool) error                         { return nil }
func (idlePlayer) Search(context.Context, ytm.SearchRequest) (ytm.SearchPage, error) {
	return ytm.SearchPage{}, nil
}
func (idlePlayer) Playlist(context.Context, string) (ytm.PlaylistPage, error) {
	return ytm.PlaylistPage{}, nil
}

const testJoinURL = "http://192.168.1.2:8080/join/TEST"

func testJoinURLNow() string { return testJoinURL }

func newTestServer() *Server {
	r := room.New("TEST", "test jam", idlePlayer{}, room.DefaultRules, nil)
	return New(r, "secret", testJoinURLNow, nil, nil)
}

func call(s *Server, method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec
}

func TestJoinGrantsHostOnlyForTheRightKey(t *testing.T) {
	cases := []struct {
		name, code, hostKey string
		wantStatus          int
		wantHost            bool
	}{
		{"no key joins as a guest", "test", "", http.StatusOK, false},
		{"right key joins as host", "test", "secret", http.StatusOK, true},
		{"stale key is refused", "test", "old-key", http.StatusForbidden, false},
		// The host page off the host's computer isn't told the code.
		{"right key needs no code", "", "secret", http.StatusOK, true},
		{"no key needs the code", "", "", http.StatusNotFound, false},
	}
	for _, c := range cases {
		body := `{"code":"` + c.code + `","name":"Rina","hostKey":"` + c.hostKey + `"}`
		rec := call(newTestServer(), http.MethodPost, "/api/join", body)
		if rec.Code != c.wantStatus {
			t.Errorf("%s: status %d, want %d", c.name, rec.Code, c.wantStatus)
			continue
		}
		var g room.Guest
		_ = json.Unmarshal(rec.Body.Bytes(), &g)
		if g.IsHost != c.wantHost {
			t.Errorf("%s: isHost = %v, want %v", c.name, g.IsHost, c.wantHost)
		}
	}
}

// Every screen sees each guest's ID (it's how "added by" works), so a cookie
// holding someone's ID must not make you them.
func TestACookieHoldingSomeonesPublicIDIsRefused(t *testing.T) {
	s := newTestServer()
	hostJoin := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Host","hostKey":"secret"}`)
	var host room.Guest
	_ = json.Unmarshal(hostJoin.Body.Bytes(), &host)

	forged := &http.Cookie{Name: guestCookie, Value: host.ID}
	if rec := call(s, http.MethodPost, "/api/host/pause", "", forged); rec.Code != http.StatusUnauthorized {
		t.Errorf("pause with the host's public id as cookie: status %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestTheRoomSnapshotNeverCarriesASessionCookie(t *testing.T) {
	s := newTestServer()
	joined := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`)
	session := joined.Result().Cookies()[0].Value
	snapshot, _ := json.Marshal(s.room.State())
	if strings.Contains(string(snapshot), session) || strings.Contains(joined.Body.String(), session) {
		t.Errorf("session cookie %q leaked into the snapshot or the join reply", session)
	}
}

func join(s *Server, body string) (room.Guest, []*http.Cookie) {
	rec := call(s, http.MethodPost, "/api/join", body)
	var g room.Guest
	_ = json.Unmarshal(rec.Body.Bytes(), &g)
	return g, rec.Result().Cookies()
}

func TestKickAnswersWithTheRightStatus(t *testing.T) {
	cases := []struct {
		name, by, whom string // by "" hasn't joined; whom "" is an ID nobody has
		want           int
	}{
		{"before joining", "", "Rina", http.StatusUnauthorized},
		{"a guest", "Dimas", "Rina", http.StatusForbidden},
		{"the host on themself", "Host", "Host", http.StatusBadRequest},
		{"nobody has that ID", "Host", "", http.StatusNotFound},
		{"the host on a guest", "Host", "Rina", http.StatusNoContent},
	}
	for _, c := range cases {
		s := newTestServer()
		ids, cookies := map[string]string{"": "nope"}, map[string][]*http.Cookie{}
		for _, body := range []string{`{"code":"TEST","name":"Host","hostKey":"secret"}`, `{"code":"TEST","name":"Rina"}`, `{"code":"TEST","name":"Dimas"}`} {
			g, cs := join(s, body)
			ids[g.Name], cookies[g.Name] = g.ID, cs
		}
		rec := call(s, http.MethodDelete, "/api/host/guests/"+ids[c.whom], "", cookies[c.by]...)
		if rec.Code != c.want {
			t.Errorf("%s: status %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body)
		}
	}
}

func TestAKickedCookieGetsGoneUntilTheyJoinAgain(t *testing.T) {
	s := newTestServer()
	_, host := join(s, `{"code":"TEST","name":"Host","hostKey":"secret"}`)
	rina, removed := join(s, `{"code":"TEST","name":"Rina"}`)
	call(s, http.MethodDelete, "/api/host/guests/"+rina.ID, "", host...)

	for _, req := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/me", ""},
		{http.MethodPost, "/api/comments", `{"text":"still here?"}`},
	} {
		rec := call(s, req.method, req.path, req.body, removed...)
		if rec.Code != http.StatusGone || !strings.Contains(rec.Body.String(), "removed you") || len(rec.Result().Cookies()) != 0 {
			t.Errorf("%s %s with the removed cookie: %d %s, cookies %v; want 410 and the cookie kept", req.method, req.path, rec.Code, rec.Body, rec.Result().Cookies())
		}
		// Or the browser answers "removed" from its cache after they join again.
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s %s with the removed cookie: Cache-Control %q, want no-store", req.method, req.path, got)
		}
	}
	_, again := join(s, `{"code":"TEST","name":"Rina"}`)
	if rec := call(s, http.MethodGet, "/api/me", "", again...); rec.Code != http.StatusOK {
		t.Errorf("/api/me after joining again: %d %s, want 200", rec.Code, rec.Body)
	}
}

func TestClientIPBelievesForwardedForOnlyFromThisMachine(t *testing.T) {
	cases := []struct {
		name, peer string
		forwarded  []string
		want       string
	}{
		{"a phone on the Wi-Fi", "192.168.1.20:5000", nil, "192.168.1.20"},
		{"a phone on the Wi-Fi claiming another address", "192.168.1.20:5000", []string{"203.0.113.7"}, "192.168.1.20"},
		{"through the tunnel", "127.0.0.1:5000", []string{"203.0.113.7"}, "203.0.113.7"},
		{"through the tunnel, caller-sent entries first", "[::1]:5000", []string{"10.0.0.1, 198.51.100.2", "203.0.113.7"}, "203.0.113.7"},
		{"the host's own browser", "127.0.0.1:5000", nil, ""},
		{"a tunnel naming garbage", "127.0.0.1:5000", []string{"not-an-ip"}, ""},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodPost, "/api/join", nil)
		req.RemoteAddr = c.peer
		for _, f := range c.forwarded {
			req.Header.Add("X-Forwarded-For", f)
		}
		if got := clientIP(req); got != c.want {
			t.Errorf("%s: clientIP = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestABlockedNetworkCantJoinUntilUnblocked(t *testing.T) {
	s := newTestServer()
	_, host := join(s, `{"code":"TEST","name":"Host","hostKey":"secret"}`)
	rina, _ := join(s, `{"code":"TEST","name":"Rina"}`) // from httptest's 192.0.2.1

	if rec := call(s, http.MethodPost, "/api/host/blocked", `{"guestId":"`+rina.ID+`"}`, host...); rec.Code != http.StatusNoContent {
		t.Fatalf("block: %d %s, want 204", rec.Code, rec.Body)
	}
	if rec := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "blocked") {
		t.Errorf("join from the blocked network: %d %s, want 403", rec.Code, rec.Body)
	}
	blocked := s.room.State().Blocked
	if body, _ := json.Marshal(blocked); len(blocked) != 1 || strings.Contains(string(body), "192.0.2.1") {
		t.Fatalf("blocked = %s, want one entry without its IP", body)
	}
	if rec := call(s, http.MethodDelete, "/api/host/blocked/"+blocked[0].ID, "", host...); rec.Code != http.StatusNoContent {
		t.Fatalf("unblock: %d %s, want 204", rec.Code, rec.Body)
	}
	if rec := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`); rec.Code != http.StatusOK {
		t.Errorf("join after unblocking: %d %s, want 200", rec.Code, rec.Body)
	}
}

func TestAWaitingGuestOnlyGetsMeUntilLetIn(t *testing.T) {
	s := newTestServer()
	_, host := join(s, `{"code":"TEST","name":"Host","hostKey":"secret"}`)
	call(s, http.MethodPut, "/api/host/rules", `{"maxAddsPerMinute":3,"skipVotesNeeded":3,"askToJoin":true}`, host...)
	rina, waiting := join(s, `{"code":"TEST","name":"Rina"}`)

	var me struct{ Waiting bool }
	rec := call(s, http.MethodGet, "/api/me", "", waiting...)
	if _ = json.Unmarshal(rec.Body.Bytes(), &me); rec.Code != http.StatusOK || !me.Waiting {
		t.Errorf("/api/me while waiting: %d %s, want 200 waiting", rec.Code, rec.Body)
	}
	if rec := call(s, http.MethodPost, "/api/comments", `{"text":"let me in"}`, waiting...); rec.Code != http.StatusForbidden || len(rec.Result().Cookies()) != 0 {
		t.Errorf("commenting while waiting: %d %s, cookies %v; want 403 and the cookie kept", rec.Code, rec.Body, rec.Result().Cookies())
	}
	if rec := call(s, http.MethodPost, "/api/host/guests", `{"guestId":"`+rina.ID+`"}`, waiting...); rec.Code != http.StatusForbidden {
		t.Errorf("letting yourself in: %d, want 403", rec.Code)
	}
	if rec := call(s, http.MethodPost, "/api/host/guests", `{"guestId":"`+rina.ID+`"}`, host...); rec.Code != http.StatusNoContent {
		t.Fatalf("host lets Rina in: %d %s, want 204", rec.Code, rec.Body)
	}
	if rec := call(s, http.MethodPost, "/api/comments", `{"text":"thanks"}`, waiting...); rec.Code != http.StatusNoContent {
		t.Errorf("commenting once let in: %d %s, want 204", rec.Code, rec.Body)
	}
}

func TestJoinWithATakenNameIsAConflict(t *testing.T) {
	s := newTestServer()
	call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`)
	rec := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"rina"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "already goes by that name") {
		t.Errorf("got %d %s", rec.Code, rec.Body)
	}
}

func TestAddSaysANonYouTubeLinkIsNotASong(t *testing.T) {
	s := newTestServer()
	joined := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`)
	rec := call(s, http.MethodPost, "/api/queue", `{"url":"https://example.com/nope"}`, joined.Result().Cookies()...)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "isn't a YouTube song") {
		t.Errorf("got %d %s", rec.Code, rec.Body)
	}
}

// droppingPlayer is the app on a queue where YouTube's reply lacks the song.
type droppingPlayer struct{ idlePlayer }

func (droppingPlayer) AddToQueue(context.Context, string, ytm.InsertPosition) error {
	return ytm.ErrNotQueued
}

func TestAddTellsTheGuestTheAppDroppedTheSong(t *testing.T) {
	s := New(room.New("TEST", "test jam", droppingPlayer{}, room.DefaultRules, nil), "secret", testJoinURLNow, nil, nil)
	joined := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`)
	rec := call(s, http.MethodPost, "/api/queue", `{"videoId":"dQw4w9WgXcQ"}`, joined.Result().Cookies()...)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "didn't take that song") {
		t.Errorf("got %d %s", rec.Code, rec.Body)
	}
}

func TestMoveIsOpenToEveryGuest(t *testing.T) {
	for _, hostKey := range []string{"", "secret"} {
		s := newTestServer()
		joined := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina","hostKey":"`+hostKey+`"}`)
		rec := call(s, http.MethodPatch, "/api/queue/a", `{"position":0}`, joined.Result().Cookies()...)
		// The idle player's queue is empty, so getting past the rules means a 404.
		if rec.Code != http.StatusNotFound {
			t.Errorf("hostKey %q: status %d, want %d", hostKey, rec.Code, http.StatusNotFound)
		}
	}
}

// Finding the public link must not be enough to join: the code and the
// join link go only to the host's computer and to whoever already joined.
func TestRoomInfoTellsTheCodeOnlyToWhoeverMayKnowIt(t *testing.T) {
	const tunnel, visitor = "127.0.0.1:5000", "203.0.113.7"
	cases := []struct {
		name      string
		peer      string
		forwarded string
		as        string // "" hasn't joined; "Rina" joined; "Waiting" asked to join; "Removed" was removed
		wantCode  bool
	}{
		{"the host's computer (menu bar, jam.sh, room view)", "127.0.0.1:5000", "", "", true},
		{"a visitor through the tunnel", tunnel, visitor, "", false},
		{"a visitor on the Wi-Fi", "192.168.1.20:5000", "", "", false},
		{"a guest through the tunnel", tunnel, visitor, "Rina", true},
		{"someone waiting to be let in", tunnel, visitor, "Waiting", true},
		{"someone the host removed", tunnel, visitor, "Removed", false},
	}
	for _, c := range cases {
		s := newTestServer()
		_, host := join(s, `{"code":"TEST","name":"Host","hostKey":"secret"}`)
		var cookies []*http.Cookie
		switch c.as {
		case "Rina":
			_, cookies = join(s, `{"code":"TEST","name":"Rina"}`)
		case "Waiting":
			call(s, http.MethodPut, "/api/host/rules", `{"maxAddsPerMinute":3,"skipVotesNeeded":3,"askToJoin":true}`, host...)
			var g room.Guest
			if g, cookies = join(s, `{"code":"TEST","name":"Waiting"}`); !g.Waiting {
				t.Fatalf("%s: joined straight in, want waiting", c.name)
			}
		case "Removed":
			var g room.Guest
			g, cookies = join(s, `{"code":"TEST","name":"Removed"}`)
			call(s, http.MethodDelete, "/api/host/guests/"+g.ID, "", host...)
		}
		req := httptest.NewRequest(http.MethodGet, "/api/room", nil)
		req.RemoteAddr = c.peer
		if c.forwarded != "" {
			req.Header.Set("X-Forwarded-For", c.forwarded)
		}
		for _, ck := range cookies {
			req.AddCookie(ck)
		}
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)

		var info struct {
			Code    string `json:"code"`
			JoinURL string `json:"joinUrl"`
			Name    string `json:"name"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &info)
		wantCode, wantURL := "", ""
		if c.wantCode {
			wantCode, wantURL = "TEST", testJoinURL
		}
		if rec.Code != http.StatusOK || info.Code != wantCode || info.JoinURL != wantURL || info.Name == "" {
			t.Errorf("%s: %d code %q joinUrl %q name %q; want 200, code %q, joinUrl %q, the name", c.name, rec.Code, info.Code, info.JoinURL, info.Name, wantCode, wantURL)
		}
	}
	if snapshot, _ := json.Marshal(newTestServer().room.State()); strings.Contains(string(snapshot), "TEST") {
		t.Errorf("the event stream, open to anyone, carries the code: %s", snapshot)
	}
}

func TestJoinsFromOneNetworkPastTheLimitAreTooMany(t *testing.T) {
	s := newTestServer()
	status := 0
	for i := range 100 {
		status = call(s, http.MethodPost, "/api/join", fmt.Sprintf(`{"code":"TEST","name":"Guest %d"}`, i)).Code
		if status != http.StatusOK {
			break
		}
	}
	if status != http.StatusTooManyRequests {
		t.Errorf("100 joins from one network: last status %d, want %d", status, http.StatusTooManyRequests)
	}
}

func TestTheGuestCookieIsSecureOnlyOverHTTPS(t *testing.T) {
	cases := []struct {
		name, proto string
		want        bool
	}{
		{"on the Wi-Fi, plain http", "", false},
		{"through the tunnel, https", "https", true},
		{"through a tunnel serving http", "http", false},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodPost, "/api/join", strings.NewReader(`{"code":"TEST","name":"Rina"}`))
		if c.proto != "" {
			req.Header.Set("X-Forwarded-Proto", c.proto)
		}
		rec := httptest.NewRecorder()
		newTestServer().ServeHTTP(rec, req)
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Secure != c.want {
			t.Errorf("%s: cookies %v, want one with Secure %v", c.name, cookies, c.want)
		}
	}
}

// searchingPlayer answers every search with one page and keeps what it was asked.
type searchingPlayer struct {
	idlePlayer
	asked *ytm.SearchRequest
}

func (p searchingPlayer) Search(_ context.Context, req ytm.SearchRequest) (ytm.SearchPage, error) {
	*p.asked = req
	return ytm.SearchPage{Tracks: []ytm.Track{{VideoID: "BSTsnWoslP4"}}, Next: "page-3", CorrectedQuery: "bohemian rhapsody"}, nil
}

func TestSearchPassesTypeAndCursorAndAnswersNextAndCorrectedQuery(t *testing.T) {
	var asked ytm.SearchRequest
	s := New(room.New("TEST", "test jam", searchingPlayer{asked: &asked}, room.DefaultRules, nil), "secret", testJoinURLNow, nil, nil)
	joined := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`)
	rec := call(s, http.MethodGet, "/api/search?q=bohemain+rapsody&type=videos&cursor=page-2", "", joined.Result().Cookies()...)

	if want := (ytm.SearchRequest{Query: "bohemain rapsody", Kind: ytm.SearchVideos, Cursor: "page-2"}); asked != want {
		t.Errorf("player asked %+v, want %+v", asked, want)
	}
	var page ytm.SearchPage
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if len(page.Tracks) != 1 || page.Next != "page-3" || page.CorrectedQuery != "bohemian rhapsody" {
		t.Errorf("got %d %s", rec.Code, rec.Body)
	}
}

func TestVolumeIsTheHostsAndNudgesAreEveryones(t *testing.T) {
	s := newTestServer()
	host := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Host","hostKey":"secret"}`).Result().Cookies()
	guest := call(s, http.MethodPost, "/api/join", `{"code":"TEST","name":"Rina"}`).Result().Cookies()
	cases := []struct {
		name, method, path, body string
		as                       []*http.Cookie
		want                     int
	}{
		{"guest sets the volume", http.MethodPut, "/api/host/volume", `{"level":20}`, guest, http.StatusForbidden},
		{"host sets the volume", http.MethodPut, "/api/host/volume", `{"level":20}`, host, http.StatusNoContent},
		{"guest mutes", http.MethodPut, "/api/host/mute", `{"muted":true}`, guest, http.StatusForbidden},
		{"host mutes", http.MethodPut, "/api/host/mute", `{"muted":true}`, host, http.StatusNoContent},
		{"guest nudges", http.MethodPost, "/api/nudges", `{"nudge":"quieter"}`, guest, http.StatusNoContent},
		{"guest nudges nonsense", http.MethodPost, "/api/nudges", `{"nudge":"deafening"}`, guest, http.StatusBadRequest},
		{"stranger nudges", http.MethodPost, "/api/nudges", `{"nudge":"louder"}`, nil, http.StatusUnauthorized},
	}
	for _, c := range cases {
		if rec := call(s, c.method, c.path, c.body, c.as...); rec.Code != c.want {
			t.Errorf("%s: status %d, want %d", c.name, rec.Code, c.want)
		}
	}
}
