package lyrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dezeto/nimbrung/internal/ytm"
)

func TestCleanTitle(t *testing.T) {
	for in, want := range map[string]string{
		"bbno$ & Rich Brian - edamame (Official Video)": "edamame",
		"Heat Waves [Official Lyric Video] (4K)":        "Heat Waves",
		"deja vu":                                       "deja vu",
		"Know My Name (feat. Coco Jones)":               "Know My Name (feat. Coco Jones)",
	} {
		if got := CleanTitle(in); got != want {
			t.Errorf("CleanTitle(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseLRC(t *testing.T) {
	got := ParseLRC("[ar: someone]\n[00:10.74] First line\n[01:02.5]Second\n[01:05.00]\n")
	want := []Line{{10.74, "First line"}, {62.5, "Second"}, {65, ""}}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d = %v, want %v", i, got[i], want[i])
		}
	}
}

func TestFindFallsBackToSearchAndRemembers(t *testing.T) {
	asked := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked++
		switch r.URL.Path {
		case "/api/get": // a video's length rarely matches the album cut; and LRCLIB has a busy moment first
			if asked == 1 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			http.NotFound(w, r)
		case "/api/search":
			if r.URL.Query().Get("track_name") != "edamame" || r.URL.Query().Get("artist_name") != "bbno$" {
				t.Errorf("searched %v", r.URL.Query())
			}
			_, _ = w.Write([]byte(`[{"plainLyrics":"plain only"},{"syncedLyrics":"[00:01.00] timed"}]`))
		}
	}))
	defer srv.Close()
	c := New(srv.URL)
	track := ytm.Track{VideoID: "v1", Title: "bbno$ & Rich Brian - edamame (Official Video)", Artist: "bbno$ & Rich Brian", Duration: 141}

	for range 2 {
		l, err := c.Find(context.Background(), track)
		if err != nil {
			t.Fatal(err)
		}
		if l == nil || len(l.Lines) != 1 || l.Lines[0].Text != "timed" {
			t.Fatalf("got %+v, want the timed hit over the plain one", l)
		}
	}
	if asked != 3 {
		t.Errorf("LRCLIB asked %d times, want 3 (get, get again after the 503, search; then remembered)", asked)
	}
}
