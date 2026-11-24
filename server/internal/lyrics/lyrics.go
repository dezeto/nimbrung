// Package lyrics finds a song's lyrics on LRCLIB (lrclib.net): free, no key,
// and most songs come with timed lines, so screens can follow along.
package lyrics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dezeto/nimbrung/internal/ytm"
)

// Line is one timed line; Text is "" for an instrumental gap.
type Line struct {
	At   float64 `json:"at"` // seconds into the song
	Text string  `json:"text"`
}

// Lyrics is what was found: timed Lines when LRCLIB has them, else Plain.
type Lyrics struct {
	Lines []Line `json:"lines,omitempty"`
	Plain string `json:"plain,omitempty"`
}

// Client asks LRCLIB and remembers every answer by video ID, misses too,
// so a room full of phones costs one lookup per song.
// ponytail: the cache only grows; a jam plays a few hundred songs at most.
type Client struct {
	base string
	http *http.Client
	mu   sync.Mutex
	seen map[string]*Lyrics // videoID -> lyrics; nil = none found
}

// New makes a client for the LRCLIB at base, like "https://lrclib.net".
func New(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: 8 * time.Second}, seen: map[string]*Lyrics{}}
}

// Find returns the track's lyrics, or nil when LRCLIB has none. An error
// means LRCLIB couldn't be asked; that isn't remembered, so the next call
// tries again.
func (c *Client) Find(ctx context.Context, t ytm.Track) (*Lyrics, error) {
	c.mu.Lock()
	l, ok := c.seen[t.VideoID]
	c.mu.Unlock()
	if ok {
		return l, nil
	}
	l, err := c.lookUp(ctx, t)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.seen[t.VideoID] = l
	c.mu.Unlock()
	return l, nil
}

// record is one LRCLIB answer.
type record struct {
	PlainLyrics  string `json:"plainLyrics"`
	SyncedLyrics string `json:"syncedLyrics"`
}

func (c *Client) lookUp(ctx context.Context, t ytm.Track) (*Lyrics, error) {
	title, artist := CleanTitle(t.Title), firstArtist(t.Artist)
	// The exact match first: title, artist and length (LRCLIB allows ±2s).
	q := url.Values{"track_name": {title}, "artist_name": {t.Artist}}
	if t.Duration > 0 {
		q.Set("duration", strconv.Itoa(t.Duration))
	}
	var exact record
	found, err := c.get(ctx, "/api/get?"+q.Encode(), &exact)
	if err != nil {
		return nil, err
	}
	if found && (exact.SyncedLyrics != "" || exact.PlainLyrics != "") {
		return toLyrics(exact), nil
	}
	// Then a search, which forgives a different length or a "feat." in the artist.
	var hits []record
	q = url.Values{"track_name": {title}, "artist_name": {artist}}
	if _, err := c.get(ctx, "/api/search?"+q.Encode(), &hits); err != nil {
		return nil, err
	}
	for _, h := range hits {
		if h.SyncedLyrics != "" {
			return toLyrics(h), nil
		}
	}
	for _, h := range hits {
		if h.PlainLyrics != "" {
			return toLyrics(h), nil
		}
	}
	return nil, nil
}

// get fetches path into out; false (and no error) means LRCLIB said 404.
// LRCLIB answers a passing 503 now and then, so a 5xx gets one more try.
func (c *Client) get(ctx context.Context, path string, out any) (bool, error) {
	found, err := c.getOnce(ctx, path, out)
	var busy *busyError
	if errors.As(err, &busy) {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(700 * time.Millisecond):
		}
		found, err = c.getOnce(ctx, path, out)
	}
	return found, err
}

type busyError struct{ status string }

func (e *busyError) Error() string { return "lrclib: " + e.status }

func (c *Client) getOnce(ctx context.Context, path string, out any) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", "nimbrung (a jam queue for YouTube Music)") // LRCLIB asks apps to say who they are
	res, err := c.http.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if res.StatusCode >= 500 {
		return false, &busyError{res.Status}
	}
	if res.StatusCode != http.StatusOK {
		return false, fmt.Errorf("lrclib: %s", res.Status)
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return false, errors.Join(errors.New("lrclib: bad answer"), err)
	}
	return true, nil
}

func toLyrics(r record) *Lyrics {
	if lines := ParseLRC(r.SyncedLyrics); len(lines) > 0 {
		return &Lyrics{Lines: lines}
	}
	return &Lyrics{Plain: strings.TrimSpace(r.PlainLyrics)}
}

var lrcLine = regexp.MustCompile(`^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$`)

// minGap is how long a wordless line must last to show as an instrumental
// break; shorter ones are just breaths between lines.
const minGap = 8.0

// ParseLRC reads "[mm:ss.xx] words" lines; anything else is skipped.
// A wordless line stays only if it's a real break: LRC files end with one
// marking where the singing stops, and sprinkle short ones between lines.
func ParseLRC(s string) []Line {
	var all []Line
	for _, raw := range strings.Split(s, "\n") {
		m := lrcLine.FindStringSubmatch(strings.TrimSpace(raw))
		if m == nil {
			continue
		}
		min, _ := strconv.Atoi(m[1])
		sec, _ := strconv.ParseFloat(m[2], 64)
		all = append(all, Line{At: float64(min)*60 + sec, Text: strings.TrimSpace(m[3])})
	}
	var out []Line
	for i, l := range all {
		if l.Text == "" && (i == len(all)-1 || all[i+1].At-l.At < minGap) {
			continue
		}
		out = append(out, l)
	}
	return out
}

// Music-video titles carry extras LRCLIB doesn't: "Artist - Song (Official Video) [4K]".
var extras = regexp.MustCompile(`(?i)\s*[(\[][^)\]]*(official|video|audio|lyric|visuali[sz]er|mv|m/v|4k|hd|remaster)[^)\]]*[)\]]`)

// CleanTitle drops video extras and an "Artist - " prefix from a title.
func CleanTitle(title string) string {
	t := extras.ReplaceAllString(title, "")
	if _, after, ok := strings.Cut(t, " - "); ok {
		t = after
	}
	return strings.TrimSpace(t)
}

// firstArtist is the lead artist of "A & B", "A, B" or "A feat. B".
func firstArtist(artist string) string {
	for _, sep := range []string{" & ", ", ", " feat. ", " ft. ", " x "} {
		if before, _, ok := strings.Cut(artist, sep); ok {
			artist = before
		}
	}
	return strings.TrimSpace(artist)
}
