package ytm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// pluginLandingAfter fakes the plugin's add: POST answers 204 at once, and
// the song only shows up in GET /queue after `polls` more reads (never if < 0).
func pluginLandingAfter(polls int) *httptest.Server {
	var added atomic.Bool
	var reads atomic.Int32
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			added.Store(true)
			w.WriteHeader(http.StatusNoContent)
		case http.MethodGet:
			row := `{"playlistPanelVideoRenderer":{"videoId":"old"}}`
			if added.Load() && polls >= 0 && int(reads.Add(1)) > polls {
				row += `,{"playlistPanelVideoRenderer":{"videoId":"new"}}`
			}
			fmt.Fprintf(w, `{"items":[%s]}`, row)
		}
	}))
}

func TestAddToQueueReturnsOnceTheSongIsQueued(t *testing.T) {
	cases := []struct {
		name  string
		polls int
		want  error
	}{
		{"lands a poll later", 1, nil},
		{"dropped by the app", -1, ErrNotQueued},
	}
	for _, c := range cases {
		srv := pluginLandingAfter(c.polls)
		cl := New(srv.URL)
		cl.addWait = time.Second // the real 8s would make the "dropped" case slow
		if err := cl.AddToQueue(context.Background(), "new", InsertAtEnd); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.want)
		}
		srv.Close()
	}
}

func TestSearchSendsTheKindsFilterAndTheCursor(t *testing.T) {
	cases := []struct {
		name                     string
		req                      SearchRequest
		wantParams, wantCursorAs string
	}{
		{"songs", SearchRequest{Query: "q", Kind: SearchSongs}, songsFilter, ""},
		{"playlists", SearchRequest{Query: "q", Kind: SearchPlaylists}, playlistsFilter, ""},
		{"an unknown kind searches songs", SearchRequest{Query: "q", Kind: "podcasts"}, songsFilter, ""},
		{"a cursor asks for the next page", SearchRequest{Query: "q", Cursor: "songs-page-2"}, songsFilter, "songs-page-2"},
	}
	for _, c := range cases {
		var sent struct{ Params, Continuation string }
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&sent)
			fmt.Fprint(w, `{}`)
		}))
		if _, err := New(srv.URL, WithYouTube("http://youtube.invalid")).Search(context.Background(), c.req); err != nil {
			t.Errorf("%s: %v", c.name, err)
		}
		if sent.Params != c.wantParams || sent.Continuation != c.wantCursorAs {
			t.Errorf("%s: sent params %q continuation %q, want %q %q", c.name, sent.Params, sent.Continuation, c.wantParams, c.wantCursorAs)
		}
		srv.Close()
	}
}

func TestPlaylistAsksYouTubeAnonymouslyForItsPage(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "browse_playlist.json"))
	if err != nil {
		t.Fatal(err)
	}
	var path, browseID, auth string
	youtube := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct{ BrowseID string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		path, browseID, auth = r.URL.Path, in.BrowseID, r.Header.Get("Authorization")
		w.Write(live)
	}))
	defer youtube.Close()
	cl := New("http://plugin.invalid", WithToken("plugin-secret"))
	cl.autoplay.youtube = youtube.URL

	page, err := cl.Playlist(context.Background(), "PLl578ZPbYIlFcSxuka8Km37VgbUYUWI5p")
	if err != nil || page.Title != "Anime Lo-fi" || len(page.Tracks) != 3 {
		t.Errorf("got %q with %d songs, %v; want Anime Lo-fi with 3", page.Title, len(page.Tracks), err)
	}
	if path != "/youtubei/v1/browse" || browseID != "VLPLl578ZPbYIlFcSxuka8Km37VgbUYUWI5p" || auth != "" {
		t.Errorf("asked %s for %q with auth %q; want browse for VL+id and no plugin token", path, browseID, auth)
	}
}

// pluginAnsweringAllInFlight fakes the plugin's search: the first reply to
// come back answers every search in flight, as its
// ipcMain.once('peard:search-results') does. A reply is one row titled with
// the query it was for.
func pluginAnsweringAllInFlight(answerAfter time.Duration) *httptest.Server {
	var mu sync.Mutex
	var inFlight []chan string
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Query string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		reply := make(chan string, 1)
		mu.Lock()
		inFlight = append(inFlight, reply)
		mu.Unlock()

		time.Sleep(answerAfter)
		mu.Lock()
		for _, ch := range inFlight {
			ch <- in.Query
		}
		inFlight = nil
		mu.Unlock()
		fmt.Fprintf(w, `{"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"v"},`+
			`"flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":%q}]}}}]}}`, <-reply)
	}))
}

func titleOf(page SearchPage) string {
	if len(page.Tracks) == 0 {
		return ""
	}
	return page.Tracks[0].Title
}

func TestConcurrentSearchesEachGetTheirOwnResults(t *testing.T) {
	srv := pluginAnsweringAllInFlight(50 * time.Millisecond)
	defer srv.Close()
	cl := New(srv.URL)

	queries := []string{"nirvana", "blackpink"}
	got := make([]string, len(queries))
	var wg sync.WaitGroup
	for i, q := range queries {
		wg.Add(1)
		go func() {
			defer wg.Done()
			page, _ := cl.Search(context.Background(), SearchRequest{Query: q})
			got[i] = titleOf(page)
		}()
	}
	wg.Wait()
	for i, q := range queries {
		if got[i] != q {
			t.Errorf("search for %q got results for %q", q, got[i])
		}
	}
}

func TestSearchAfterAnAbandonedOneGetsItsOwnResults(t *testing.T) {
	srv := pluginAnsweringAllInFlight(100 * time.Millisecond)
	defer srv.Close()
	cl := New(srv.URL)

	gaveUp, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	go cl.Search(gaveUp, SearchRequest{Query: "nirvana"})
	time.Sleep(30 * time.Millisecond) // that guest has gone; the plugin is still searching

	page, err := cl.Search(context.Background(), SearchRequest{Query: "blackpink"})
	if err != nil || titleOf(page) != "blackpink" {
		t.Errorf("got results for %q (err %v), want %q", titleOf(page), err, "blackpink")
	}
}

// The room calls Autoplay on every poll, right after Queue.
func TestAutoplayAsksYouTubeOncePerTokenAndLastSong(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "next_autoplay.json"))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name      string
		every     time.Duration  // the least time between two asks
		polls     []autoplaySeed // the queue's continuation and last song on each poll
		status    int            // how YouTube answers
		wantAsked []string       // continuations YouTube was asked for
		wantSongs int            // after the last poll
	}{
		{"polling one queue asks once", 0, []autoplaySeed{{"tok-1", "a"}, {"tok-1", "a"}, {"tok-1", "a"}}, http.StatusOK, []string{"tok-1"}, 3},
		// The app keeps one token all session; YouTube's answer to it moves on.
		{"the same token with a new last song asks again", 0, []autoplaySeed{{"tok-1", "a"}, {"tok-1", "b"}}, http.StatusOK, []string{"tok-1", "tok-1"}, 3},
		{"a new token asks again", 0, []autoplaySeed{{"tok-1", "a"}, {"tok-1", "a"}, {"tok-2", "a"}}, http.StatusOK, []string{"tok-1", "tok-2"}, 3},
		{"a new last song too soon keeps the last answer", time.Hour, []autoplaySeed{{"tok-1", "a"}, {"tok-1", "b"}}, http.StatusOK, []string{"tok-1"}, 3},
		{"a queue without a token asks nothing", 0, []autoplaySeed{{"", "a"}, {"", "b"}}, http.StatusOK, nil, 0},
		{"YouTube failing gives no songs and no retry for that queue", 0, []autoplaySeed{{"tok-1", "a"}, {"tok-1", "a"}}, http.StatusInternalServerError, []string{"tok-1"}, 0},
	}
	for _, c := range cases {
		var seed atomic.Value
		plugin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s := seed.Load().(autoplaySeed)
			fmt.Fprintf(w, `{"items":[{"playlistPanelVideoRenderer":{"videoId":"playing","selected":true}},{"playlistPanelVideoRenderer":{"videoId":%q}}],"continuation":%q}`, s.last, s.token)
		}))
		var mu sync.Mutex
		var asked []string
		youtube := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "" {
				t.Errorf("%s: YouTube got the plugin's token", c.name)
			}
			var in struct{ Continuation string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			mu.Lock()
			asked = append(asked, in.Continuation)
			mu.Unlock()
			w.WriteHeader(c.status)
			w.Write(live)
		}))
		cl := New(plugin.URL, WithToken("plugin-secret"))
		cl.autoplay.youtube, cl.autoplay.every = youtube.URL, c.every

		var songs []Track
		for _, s := range c.polls {
			seed.Store(s)
			if _, err := cl.Queue(context.Background()); err != nil {
				t.Fatalf("%s: queue: %v", c.name, err)
			}
			songs = cl.Autoplay(context.Background())
		}
		mu.Lock()
		if !slices.Equal(asked, c.wantAsked) || len(songs) != c.wantSongs {
			t.Errorf("%s: asked YouTube for %q and got %d songs, want %q and %d", c.name, asked, len(songs), c.wantAsked, c.wantSongs)
		}
		mu.Unlock()
		plugin.Close()
		youtube.Close()
	}
}

func TestSetMutedTogglesOnlyWhenTheAppDisagrees(t *testing.T) {
	cases := []struct {
		name        string
		muted, want bool
		wantToggles int32
	}{
		{"mute an unmuted app", false, true, 1},
		{"mute a muted app", true, true, 0},
		{"unmute an unmuted app", false, false, 0},
	}
	for _, c := range cases {
		var toggles atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/api/v1/volume":
				fmt.Fprintf(w, `{"state":62.6,"isMuted":%t}`, c.muted)
			case "/api/v1/toggle-mute":
				toggles.Add(1)
				w.WriteHeader(http.StatusNoContent)
			}
		}))
		cl := New(srv.URL)
		if err := cl.SetMuted(context.Background(), c.want); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got := toggles.Load(); got != c.wantToggles {
			t.Errorf("%s: toggled %d times, want %d", c.name, got, c.wantToggles)
		}
		if v, _ := cl.Volume(context.Background()); v.Level != 63 {
			t.Errorf("%s: level = %d, want 63 (rounded)", c.name, v.Level)
		}
		srv.Close()
	}
}

func TestArtistAsksYouTubeForThePageThenItsSongsAndRemembers(t *testing.T) {
	page, err := os.ReadFile(filepath.Join("testdata", "browse_artist.json"))
	if err != nil {
		t.Fatal(err)
	}
	songs, err := os.ReadFile(filepath.Join("testdata", "browse_artist_songs.json"))
	if err != nil {
		t.Fatal(err)
	}
	var asked []string
	youtube := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct{ BrowseID string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		asked = append(asked, in.BrowseID)
		if strings.HasPrefix(in.BrowseID, "VL") {
			w.Write(songs)
			return
		}
		w.Write(page)
	}))
	defer youtube.Close()
	cl := New("http://plugin.invalid", WithToken("plugin-secret"))
	cl.autoplay.youtube = youtube.URL

	const tulus = "UC_DHlXllTSMB8pTC38_leFg"
	for range 2 {
		got, err := cl.Artist(context.Background(), tulus)
		if err != nil || got.ID != tulus || got.Name != "Tulus" || len(got.Tracks) != 6 || got.Tracks[0].Duration != 213 {
			t.Errorf("got %q (%s) with %d songs, %v; want Tulus with the playlist's 6", got.Name, got.ID, len(got.Tracks), err)
		}
		if len(got.Albums) != 4 || got.Albums[0].Artist != "Tulus" || got.Albums[0].ArtistID != tulus {
			t.Errorf("got albums %+v; want 4, each by Tulus", got.Albums)
		}
	}
	if want := []string{tulus, "VLOLAK5uy_mHgw7gB4UOePEByyIUPoXcCIWTbVade7w"}; !reflect.DeepEqual(asked, want) {
		t.Errorf("asked YouTube for %v, want %v once", asked, want)
	}
}

func TestSearchForVideosArtistsAndAlbumsSkipsThePlugin(t *testing.T) {
	cases := []struct {
		name       string
		req        SearchRequest
		wantParams string
	}{
		{"videos", SearchRequest{Query: "q", Kind: SearchVideos}, videosFilter},
		{"more videos", SearchRequest{Query: "q", Kind: SearchVideos, Cursor: "videos-page-2"}, videosFilter},
		{"artists", SearchRequest{Query: "q", Kind: SearchArtists}, artistsFilter},
		{"more albums", SearchRequest{Query: "q", Kind: SearchAlbums, Cursor: "albums-page-2"}, albumsFilter},
	}
	for _, c := range cases {
		var sent struct{ Query, Params, Continuation string }
		var path string
		youtube := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&sent)
			path = r.URL.Path
			fmt.Fprint(w, `{}`)
		}))
		cl := New("http://plugin.invalid", WithYouTube(youtube.URL)) // a call to the plugin would fail
		if _, err := cl.Search(context.Background(), c.req); err != nil {
			t.Errorf("%s: %v", c.name, err)
		}
		// YouTube wants the query and filter again alongside the cursor.
		if path != "/youtubei/v1/search" || sent.Query != "q" || sent.Params != c.wantParams || sent.Continuation != c.req.Cursor {
			t.Errorf("%s: asked %s for %+v; want the search endpoint, %q and cursor %q", c.name, path, sent, c.wantParams, c.req.Cursor)
		}
		youtube.Close()
	}
}

func TestAlbumAsksYouTubeOnceForAnAlbum(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "browse_album.json"))
	if err != nil {
		t.Fatal(err)
	}
	var asked []string
	youtube := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct{ BrowseID string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		asked = append(asked, in.BrowseID)
		if in.BrowseID != "MPREb_LQwx7Jq6u9H" {
			fmt.Fprint(w, `{"contents":{}}`) // what YouTube answers for a browse ID it has no album for
			return
		}
		w.Write(live)
	}))
	defer youtube.Close()
	cl := New("http://plugin.invalid", WithYouTube(youtube.URL))

	for range 2 {
		got, err := cl.Album(context.Background(), "MPREb_LQwx7Jq6u9H")
		if err != nil || got.ID != "MPREb_LQwx7Jq6u9H" || got.Title != "Abbey Road (2019 Mix)" || len(got.Tracks) != 3 {
			t.Errorf("got %q (%s) with %d songs, %v; want Abbey Road with 3", got.Title, got.ID, len(got.Tracks), err)
		}
	}
	for range 2 {
		if got, err := cl.Album(context.Background(), "MPREb_LQwx7Jq6u9X"); err != nil || got.Title != "" {
			t.Errorf("not an album: got %+v, %v; want an empty page", got, err)
		}
	}
	if want := []string{"MPREb_LQwx7Jq6u9H", "MPREb_LQwx7Jq6u9X", "MPREb_LQwx7Jq6u9X"}; !reflect.DeepEqual(asked, want) {
		t.Errorf("asked YouTube for %v, want %v: albums remembered, non-albums not", asked, want)
	}
}

func TestFindTrackAsksYouTubesNextForTheVideo(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "next_track.json"))
	if err != nil {
		t.Fatal(err)
	}
	var path, videoID string
	youtube := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct{ VideoID string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		path, videoID = r.URL.Path, in.VideoID
		w.Write(live)
	}))
	defer youtube.Close()
	cl := New("http://plugin.invalid", WithYouTube(youtube.URL))

	got, err := cl.FindTrack(context.Background(), "BSTsnWoslP4")
	if err != nil || got.Title != "Bohemian Rhapsody" || path != "/youtubei/v1/next" || videoID != "BSTsnWoslP4" {
		t.Errorf("asked %s for %q and got %+v, %v", path, videoID, got, err)
	}
}
