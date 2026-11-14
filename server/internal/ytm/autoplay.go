package ytm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// YouTube Music's newer autoplay keeps its songs out of the app's queue, and
// the plugin has no endpoint for them. The queue does carry the continuation
// token the web player sends YouTube for them, so Autoplay sends it too. The
// token stays the same all session while YouTube's answer to it moves on, so
// it's asked again whenever the queue's last song changes. It asks
// anonymously (the host's login stays inside the app), so the answer is a
// guess that only partly matches what the app goes on to play.

const (
	youtubeMusic      = "https://music.youtube.com"
	youtubeClientName = "WEB_REMIX"
	// YouTube refuses client versions it thinks too old: bump this if the
	// guess goes empty and the log says the ask failed.
	youtubeClientVersion = "1.20241023.01.00"
	youtubeLanguage      = "en"

	// The room asks on every poll and the last song changes about once a song;
	// this keeps a burst of skips or adds from turning into a burst of calls.
	autoplayEvery = 10 * time.Second
	// autoplayTimeout bounds how long a slow YouTube holds up the room's poll.
	autoplayTimeout = 3 * time.Second
)

// autoplayGuess caches YouTube's answer for one queue.
type autoplayGuess struct {
	youtube string        // base URL; tests point it at a fake
	every   time.Duration // the least time between two asks
	latest  atomic.Value  // autoplaySeed: what the latest Queue call saw

	mu      sync.Mutex // held while asking, so two polls never ask twice
	asked   autoplaySeed
	askedAt time.Time
	tracks  []Track
}

// autoplaySeed is what YouTube's guess depends on: the queue's continuation
// token and the song autoplay picks up after.
type autoplaySeed struct{ token, last string }

// Autoplay is what YouTube suggests after the queue the latest Queue call
// saw. YouTube is asked at most once per seed and once per autoplayEvery. A
// failed ask gives an empty list until the seed changes, and is only logged:
// the guess must never break the room's poll.
func (c *Client) Autoplay(ctx context.Context) []Track {
	g := &c.autoplay
	seed, _ := g.latest.Load().(autoplaySeed)
	if seed.token == "" {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if seed != g.asked && time.Since(g.askedAt) >= g.every {
		g.asked, g.askedAt = seed, time.Now()
		tracks, err := c.askYouTube(ctx, seed.token)
		if err != nil {
			c.log.Warn("can't guess what autoplay plays next", "err", err)
		}
		g.tracks = tracks
	}
	return g.tracks
}

// askYouTube sends the token to YouTube's next endpoint, as the web player
// does, minus the host's login.
func (c *Client) askYouTube(ctx context.Context, continuation string) ([]Track, error) {
	// A guest leaving mid-ask mustn't cost everyone the guess for the song.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), autoplayTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "next", map[string]any{"continuation": continuation})
	if err != nil {
		return nil, err
	}
	return parseAutoplay(raw)
}

// youtubei posts fields to one of YouTube Music's own endpoints the way the
// web player does, minus the host's login. It doesn't go through do, which
// would hand YouTube the plugin's token.
func (c *Client) youtubei(ctx context.Context, endpoint string, fields map[string]any) ([]byte, error) {
	fields["context"] = map[string]any{"client": map[string]string{
		"clientName": youtubeClientName, "clientVersion": youtubeClientVersion, "hl": youtubeLanguage,
	}}
	body, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	url := c.autoplay.youtube + "/youtubei/v1/" + endpoint + "?prettyPrint=false"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ytm: youtube %s: %w", endpoint, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ytm: youtube %s: status %d", endpoint, res.StatusCode)
	}
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("ytm: youtube %s: %w", endpoint, err)
	}
	return raw, nil
}
