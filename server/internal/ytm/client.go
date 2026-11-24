package ytm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// Player is the subset of the desktop app that Nimbrung drives. The room
// package depends on this interface, not on *Client, so tests can use a fake.
type Player interface {
	NowPlaying(ctx context.Context) (*NowPlaying, error) // nil, nil when nothing is playing
	Queue(ctx context.Context) ([]QueueItem, error)
	Autoplay(ctx context.Context) []Track // a guess at what plays after the queue; empty, never an error, when unknown
	Search(ctx context.Context, req SearchRequest) (SearchPage, error)
	Playlist(ctx context.Context, id string) (PlaylistPage, error)
	Artist(ctx context.Context, id string) (ArtistPage, error) // an empty page when id isn't an artist
	Suggest(ctx context.Context, input string) []string        // ways to finish a search; empty, never an error, when unknown
	AddToQueue(ctx context.Context, videoID string, pos InsertPosition) error
	RemoveFromQueue(ctx context.Context, index int) error
	MoveInQueue(ctx context.Context, fromIndex, toIndex int) error // toIndex is where the row ends up
	Next(ctx context.Context) error
	Play(ctx context.Context) error
	Pause(ctx context.Context) error
	Volume(ctx context.Context) (Volume, error)
	SetVolume(ctx context.Context, level int) error // 0–100
	SetMuted(ctx context.Context, muted bool) error
}

// ErrUnauthorized is returned when the plugin rejects our token. The host
// has to approve the client in the desktop app (or set auth to NONE).
var ErrUnauthorized = errors.New("ytm: unauthorized — approve Nimbrung in the YouTube Music app")

// ErrNotQueued means the app accepted an add but never queued the song: the
// plugin answers before the app fetches the song from YouTube, and the app
// silently drops the add when that fetch comes back without it.
var ErrNotQueued = errors.New("YouTube Music didn't take that song — try again")

// Client talks to the API Server plugin over HTTP.
type Client struct {
	base    string // e.g. http://127.0.0.1:26538
	http    *http.Client
	token   string
	addWait time.Duration // how long AddToQueue watches for the song to land
	// searching is held while a search is with the plugin; see Search.
	searching sync.Mutex
	autoplay  autoplayGuess // see autoplay.go
	artists   artistCache   // see artist.go
	log       *slog.Logger
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient replaces the default http.Client (useful for tests).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithToken sets a JWT obtained earlier via Authorize.
func WithToken(t string) Option { return func(c *Client) { c.token = t } }

// WithYouTube points the calls made to YouTube itself (autoplay, playlists,
// artists, suggestions) somewhere else: a stand-in, so tests stay offline.
func WithYouTube(base string) Option { return func(c *Client) { c.autoplay.youtube = base } }

// WithLogger sets where the client reports problems it works around itself.
func WithLogger(l *slog.Logger) Option { return func(c *Client) { c.log = l } }

// New returns a Client for the plugin at base (scheme + host + port).
func New(base string, opts ...Option) *Client {
	c := &Client{
		base:    base,
		http:    &http.Client{Timeout: 10 * time.Second},
		addWait: 8 * time.Second,
		log:     slog.Default(),

		autoplay: autoplayGuess{youtube: youtubeMusic, every: autoplayEvery},
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Authorize asks the plugin for an access token. With the plugin's default
// "AUTH_AT_FIRST" strategy the host sees a dialog and must click Allow.
// clientID is any stable string identifying this Nimbrung install.
func (c *Client) Authorize(ctx context.Context, clientID string) (string, error) {
	var out struct {
		AccessToken string `json:"accessToken"`
	}
	if err := c.do(ctx, http.MethodPost, "/auth/"+url.PathEscape(clientID), nil, &out); err != nil {
		return "", err
	}
	c.token = out.AccessToken
	return out.AccessToken, nil
}

// Token returns the current access token (empty if not authorised).
func (c *Client) Token() string { return c.token }

func (c *Client) NowPlaying(ctx context.Context) (*NowPlaying, error) {
	var raw songInfoResponse
	err := c.do(ctx, http.MethodGet, "/api/v1/song", nil, &raw)
	if errors.Is(err, errNoContent) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return raw.toNowPlaying(), nil
}

func (c *Client) Queue(ctx context.Context) ([]QueueItem, error) {
	var raw json.RawMessage
	err := c.do(ctx, http.MethodGet, "/api/v1/queue", nil, &raw)
	if errors.Is(err, errNoContent) {
		c.autoplay.latest.Store(autoplaySeed{}) // nothing queued, nothing for autoplay to follow
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	items, continuation, err := parseQueue(raw)
	seed := autoplaySeed{token: continuation}
	if len(items) > 0 {
		seed.last = items[len(items)-1].VideoID // autoplay picks up where the queue ends
	}
	c.autoplay.latest.Store(seed)
	return items, err
}

// InnerTube's search filter tokens, as ytmusicapi's get_search_params builds
// them. YouTube answers a token it no longer knows with the unfiltered
// layout, not an error, and parseSearch reads that layout too.
const (
	songsFilter     = "EgWKAQIIAWoMEA4QChADEAQQCRAF"
	videosFilter    = "EgWKAQIQAWoMEA4QChADEAQQCRAF"
	playlistsFilter = "EgWKAQIoAWoMEA4QChADEAQQCRAF"
)

// filter is k's params token. An unknown kind searches songs: that's what
// guests are after.
func (k SearchKind) filter() string {
	switch k {
	case SearchVideos:
		return videosFilter
	case SearchPlaylists:
		return playlistsFilter
	default:
		return songsFilter
	}
}

// searchTimeout bounds how long one search holds up the next.
const searchTimeout = 10 * time.Second

// Search sends one search at a time. The plugin answers every search in
// flight with whichever reply comes back first, so two guests searching at
// once would get each other's results. A search keeps its turn until the
// plugin answers even if the guest gave up, or that late reply would land on
// the next search.
func (c *Client) Search(ctx context.Context, req SearchRequest) (SearchPage, error) {
	if req.Kind == SearchArtists {
		return c.searchArtists(ctx, req.Query) // straight to YouTube: no turn to wait for
	}
	c.searching.Lock()
	defer c.searching.Unlock()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), searchTimeout)
	defer cancel()
	body := struct {
		Query        string `json:"query"`
		Params       string `json:"params"`
		Continuation string `json:"continuation,omitempty"`
	}{req.Query, req.Kind.filter(), req.Cursor}
	var raw json.RawMessage
	if err := c.do(ctx, http.MethodPost, "/api/v1/search", body, &raw); err != nil {
		return SearchPage{}, err
	}
	return parseSearch(raw)
}

// AddToQueue returns once the song is really in the app's queue. The plugin's
// 204 only means "passed to the app", which queues it ~2s later or drops it
// without a word, so we watch the queue instead of trusting the 204.
func (c *Client) AddToQueue(ctx context.Context, videoID string, pos InsertPosition) error {
	if pos == "" {
		pos = InsertAtEnd
	}
	before, err := c.copiesInQueue(ctx, videoID)
	if err != nil {
		return err
	}
	body := struct {
		VideoID        string         `json:"videoId"`
		InsertPosition InsertPosition `json:"insertPosition"`
	}{videoID, pos}
	if err := ignoreNoContent(c.do(ctx, http.MethodPost, "/api/v1/queue", body, nil)); err != nil {
		return err
	}
	for deadline := time.Now().Add(c.addWait); time.Now().Before(deadline); {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
		n, err := c.copiesInQueue(ctx, videoID)
		if err != nil {
			return err
		}
		if n > before {
			return nil
		}
	}
	return ErrNotQueued
}

// copiesInQueue counts a song's rows, so one that already played (and still
// sits above the current row) doesn't look like the new copy landing.
func (c *Client) copiesInQueue(ctx context.Context, videoID string) (int, error) {
	queue, err := c.Queue(ctx)
	n := 0
	for _, q := range queue {
		if q.VideoID == videoID {
			n++
		}
	}
	return n, err
}

func (c *Client) RemoveFromQueue(ctx context.Context, index int) error {
	return ignoreNoContent(c.do(ctx, http.MethodDelete, "/api/v1/queue/"+strconv.Itoa(index), nil, nil))
}

func (c *Client) MoveInQueue(ctx context.Context, fromIndex, toIndex int) error {
	body := map[string]int{"toIndex": toIndex}
	return ignoreNoContent(c.do(ctx, http.MethodPatch, "/api/v1/queue/"+strconv.Itoa(fromIndex), body, nil))
}

func (c *Client) Next(ctx context.Context) error {
	return ignoreNoContent(c.do(ctx, http.MethodPost, "/api/v1/next", nil, nil))
}

func (c *Client) Play(ctx context.Context) error {
	return ignoreNoContent(c.do(ctx, http.MethodPost, "/api/v1/play", nil, nil))
}

func (c *Client) Pause(ctx context.Context) error {
	return ignoreNoContent(c.do(ctx, http.MethodPost, "/api/v1/pause", nil, nil))
}

func (c *Client) Volume(ctx context.Context) (Volume, error) {
	var raw struct {
		State   float64 `json:"state"`
		IsMuted bool    `json:"isMuted"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/v1/volume", nil, &raw); err != nil {
		return Volume{}, err
	}
	return Volume{Level: int(math.Round(raw.State)), Muted: raw.IsMuted}, nil
}

func (c *Client) SetVolume(ctx context.Context, level int) error {
	return ignoreNoContent(c.do(ctx, http.MethodPost, "/api/v1/volume", map[string]int{"volume": level}, nil))
}

// SetMuted mutes or unmutes. The plugin can only toggle, so it looks first:
// two of the host's devices pressing Mute at once mustn't cancel out.
func (c *Client) SetMuted(ctx context.Context, muted bool) error {
	v, err := c.Volume(ctx)
	if err != nil {
		return err
	}
	if v.Muted == muted {
		return nil
	}
	return ignoreNoContent(c.do(ctx, http.MethodPost, "/api/v1/toggle-mute", nil, nil))
}

// --- plumbing ---------------------------------------------------------------

var errNoContent = errors.New("ytm: no content")

func ignoreNoContent(err error) error {
	if errors.Is(err, errNoContent) {
		return nil
	}
	return err
}

// do performs one request. A nil out skips decoding. 204 responses surface
// as errNoContent so callers can distinguish "nothing playing" from errors.
func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("ytm: %s %s: %w", method, path, err)
	}
	defer res.Body.Close()

	switch {
	case res.StatusCode == http.StatusNoContent:
		return errNoContent
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return ErrUnauthorized
	case res.StatusCode >= 300:
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("ytm: %s %s: status %d: %s", method, path, res.StatusCode, bytes.TrimSpace(msg))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// songInfoResponse mirrors the plugin's SongInfoSchema.
type songInfoResponse struct {
	Title          string  `json:"title"`
	Artist         string  `json:"artist"`
	Album          *string `json:"album"`
	ImageSrc       *string `json:"imageSrc"`
	IsPaused       bool    `json:"isPaused"`
	SongDuration   float64 `json:"songDuration"`
	ElapsedSeconds float64 `json:"elapsedSeconds"`
	VideoID        string  `json:"videoId"`
}

func (s songInfoResponse) toNowPlaying() *NowPlaying {
	np := &NowPlaying{
		Track: Track{
			VideoID:  s.VideoID,
			Title:    s.Title,
			Artist:   s.Artist,
			Duration: int(s.SongDuration),
		},
		Elapsed:  int(s.ElapsedSeconds),
		IsPaused: s.IsPaused,
	}
	if s.Album != nil {
		np.Album = *s.Album
	}
	if s.ImageSrc != nil {
		np.Thumb = *s.ImageSrc
	}
	return np
}
