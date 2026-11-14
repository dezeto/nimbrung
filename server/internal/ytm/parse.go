package ytm

import (
	"encoding/json"
	"strconv"
	"strings"
)

// The plugin forwards YouTube's InnerTube JSON untouched for /queue and
// /search. InnerTube is deeply nested and changes shape without notice, so
// instead of modelling it we walk the tree looking for the renderer objects
// we care about and pull a handful of fields out of each. Anything we can't
// find degrades to an empty string rather than an error.

// node is a loosely typed JSON object.
type node map[string]any

// parseQueue extracts queue rows from the raw /api/v1/queue response, plus
// the continuation token YouTube's next endpoint takes to list what autoplay
// may play after them ("" when there's none).
func parseQueue(raw json.RawMessage) ([]QueueItem, string, error) {
	var root struct {
		Items        []json.RawMessage `json:"items"`
		Continuation string            `json:"continuation"`
	}
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, "", err
	}
	items := make([]QueueItem, 0, len(root.Items))
	for i, it := range root.Items {
		var n node
		if err := json.Unmarshal(it, &n); err != nil {
			continue
		}
		r := n.obj("playlistPanelVideoRenderer")
		if r == nil {
			// Autoplay / radio rows are wrapped one level deeper.
			r = n.obj("playlistPanelVideoWrapperRenderer").obj("primaryRenderer").obj("playlistPanelVideoRenderer")
		}
		if r == nil {
			continue
		}
		items = append(items, QueueItem{
			Index:    i,
			Selected: r.bool("selected"),
			Track:    panelTrack(r),
		})
	}
	return items, root.Continuation, nil
}

// parseAutoplay extracts the songs from YouTube's raw next response to a
// queue's continuation token.
func parseAutoplay(raw json.RawMessage) ([]Track, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	var tracks []Track
	walk(root, "playlistPanelContinuation", func(panel node) {
		for _, row := range panel.list("contents") {
			if r := row.obj("playlistPanelVideoRenderer"); r.str("videoId") != "" {
				tracks = append(tracks, panelTrack(r))
			}
		}
	})
	return tracks, nil
}

// panelTrack reads a playlistPanelVideoRenderer, the row shape of both the
// plugin's queue and YouTube's autoplay list.
func panelTrack(r node) Track {
	return Track{
		VideoID:  r.str("videoId"),
		Title:    r.obj("title").runsText(),
		Artist:   artistFromByline(r.obj("longBylineText").runs()),
		Thumb:    r.obj("thumbnail").bestThumb(),
		Duration: parseDuration(r.obj("lengthText").runsText()),
	}
}

// parseSearch extracts one page of song rows from the raw /api/v1/search
// response: a first page, or a "More results" page, whose rows sit under
// continuationContents instead.
func parseSearch(raw json.RawMessage) (SearchPage, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return SearchPage{}, err
	}
	cardArtists := topResultArtists(root)
	page := SearchPage{Next: nextCursor(root), CorrectedQuery: correctedQuery(root)}
	seen := map[string]bool{}
	walk(root, "musicResponsiveListItemRenderer", func(r node) {
		if p, ok := playlistRow(r); ok {
			if !seen[p.ID] {
				seen[p.ID] = true
				page.Playlists = append(page.Playlists, p)
			}
			return
		}
		t, ok := trackRow(r)
		if !ok || seen[t.VideoID] {
			return
		}
		if t.Artist == "" {
			t.Artist = cardArtists[t.VideoID]
		}
		seen[t.VideoID] = true
		page.Tracks = append(page.Tracks, t)
	})
	return page, nil
}

// parsePlaylist extracts a playlist's title and songs from YouTube's raw
// browse response for it. Only its own shelf counts, not suggestions.
func parsePlaylist(raw json.RawMessage) (PlaylistPage, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return PlaylistPage{}, err
	}
	var page PlaylistPage
	walk(root, "musicResponsiveHeaderRenderer", func(h node) { page.Title = h.obj("title").runsText() })
	seen := map[string]bool{}
	walk(root, "musicPlaylistShelfRenderer", func(shelf node) {
		walk(map[string]any(shelf), "musicResponsiveListItemRenderer", func(r node) {
			if t, ok := trackRow(r); ok && !seen[t.VideoID] {
				seen[t.VideoID] = true
				page.Tracks = append(page.Tracks, t)
			}
		})
	})
	return page, nil
}

// trackRow reads a song or video row of a search or playlist page; false
// for rows that aren't one (no videoId, a podcast episode, no title).
func trackRow(r node) (Track, bool) {
	id := r.obj("playlistItemData").str("videoId")
	if id == "" {
		return Track{}, false
	}
	t := Track{VideoID: id, Thumb: rowThumb(r), Title: flexColumn(r, 0).runsText()}
	runs := flexColumn(r, 1).runs()
	if leadingLabel(runs) == labelEpisode {
		return Track{}, false // podcast episodes have a videoId but aren't songs
	}
	t.Artist, t.Album, t.Duration = splitSubtitle(runs)
	// A playlist's rows give the album and the duration columns of their own.
	if fixed := r.list("fixedColumns"); len(fixed) > 0 {
		if t.Album == "" {
			t.Album = flexColumn(r, 2).runsText()
		}
		if t.Duration == 0 {
			t.Duration = parseDuration(fixed[0].obj("musicResponsiveListItemFixedColumnRenderer").obj("text").runsText())
		}
	}
	if videoTypeOf(r).isVideo() {
		t.Album = "" // a video's subtitle has its view count where a song's has the album
	}
	return t, t.Title != ""
}

// musicPagePlaylist is the page type a playlist row opens.
const musicPagePlaylist = "MUSIC_PAGE_TYPE_PLAYLIST"

// playlistRow reads a playlist row of a search page: "Title" over
// "Author • 11M views".
func playlistRow(r node) (Playlist, bool) {
	browse := r.obj("navigationEndpoint").obj("browseEndpoint")
	page := browse.obj("browseEndpointContextSupportedConfigs").obj("browseEndpointContextMusicConfig").str("pageType")
	id, ok := strings.CutPrefix(browse.str("browseId"), "VL")
	if page != musicPagePlaylist || !ok || id == "" {
		return Playlist{}, false
	}
	p := Playlist{ID: id, Title: flexColumn(r, 0).runsText(), Thumb: rowThumb(r)}
	p.Author, _, _ = splitSubtitle(flexColumn(r, 1).runs())
	return p, p.Title != ""
}

// flexColumn is the text of a list row's i-th column; nil past the last.
func flexColumn(r node, i int) node {
	cols := r.list("flexColumns")
	if i >= len(cols) {
		return nil
	}
	return cols[i].obj("musicResponsiveListItemFlexColumnRenderer").obj("text")
}

func rowThumb(r node) string {
	return r.obj("thumbnail").obj("musicThumbnailRenderer").obj("thumbnail").bestThumb()
}

// topResultArtists maps videoId → artist for the songs inside a "Top result"
// artist card. Those rows only say "Song • 4:08"; the artist is the card's
// title. Other card kinds (album, song) are left alone.
func topResultArtists(root any) map[string]string {
	out := map[string]string{}
	walk(root, "musicCardShelfRenderer", func(card node) {
		if leadingLabel(card.obj("subtitle").runs()) != labelArtist {
			return
		}
		artist := card.obj("title").runsText()
		// walk switches on map[string]any, so the named node type must be unwrapped.
		walk(map[string]any(card), "musicResponsiveListItemRenderer", func(r node) {
			if id := r.obj("playlistItemData").str("videoId"); id != "" {
				out[id] = artist
			}
		})
	})
	return out
}

// nextCursor is the token for the page after this one; "" on the last page.
func nextCursor(root any) string {
	var next string
	walk(root, "nextContinuationData", func(n node) { next = n.str("continuation") })
	return next
}

// correctedQuery is what YouTube searched for instead when it fixed a typo.
func correctedQuery(root any) string {
	var q string
	walk(root, "showingResultsForRenderer", func(n node) { q = n.obj("correctedQuery").runsText() })
	return q
}

// --- helpers ----------------------------------------------------------------

// rowLabel is the type word YouTube puts first in a row's subtitle
// ("Song • Artist • 3:45"), lower-cased.
type rowLabel string

const (
	labelSong     rowLabel = "song"
	labelLagu     rowLabel = "lagu" // "song" in the Indonesian UI
	labelVideo    rowLabel = "video"
	labelEpisode  rowLabel = "episode"
	labelSingle   rowLabel = "single"
	labelAlbum    rowLabel = "album"
	labelPlaylist rowLabel = "playlist"
	labelArtist   rowLabel = "artist"
)

// leadingLabel returns the first run as a rowLabel, e.g. labelEpisode.
func leadingLabel(runs []string) rowLabel {
	if len(runs) == 0 {
		return ""
	}
	return rowLabel(strings.ToLower(strings.TrimSpace(runs[0])))
}

// walk calls fn for every object found under a key named want, depth-first.
func walk(v any, want string, fn func(node)) {
	switch x := v.(type) {
	case map[string]any:
		for k, child := range x {
			if k == want {
				if obj, ok := child.(map[string]any); ok {
					fn(node(obj))
				}
			}
			walk(child, want, fn)
		}
	case []any:
		for _, child := range x {
			walk(child, want, fn)
		}
	}
}

func (n node) obj(key string) node {
	if n == nil {
		return nil
	}
	if m, ok := n[key].(map[string]any); ok {
		return node(m)
	}
	return nil
}

func (n node) list(key string) []node {
	if n == nil {
		return nil
	}
	arr, _ := n[key].([]any)
	out := make([]node, 0, len(arr))
	for _, e := range arr {
		if m, ok := e.(map[string]any); ok {
			out = append(out, node(m))
		}
	}
	return out
}

func (n node) str(key string) string {
	if n == nil {
		return ""
	}
	s, _ := n[key].(string)
	return s
}

func (n node) bool(key string) bool {
	if n == nil {
		return false
	}
	b, _ := n[key].(bool)
	return b
}

// runs returns the text runs of a {"runs":[{"text":..}]} object.
func (n node) runs() []string {
	var out []string
	for _, r := range n.list("runs") {
		out = append(out, r.str("text"))
	}
	return out
}

func (n node) runsText() string { return strings.Join(n.runs(), "") }

// bestThumb returns the largest thumbnail URL in a {"thumbnails":[...]} object.
func (n node) bestThumb() string {
	best, bestW := "", -1.0
	for _, t := range n.list("thumbnails") {
		w, _ := t["width"].(float64)
		if w > bestW {
			best, bestW = t.str("url"), w
		}
	}
	return best
}

// artistFromByline takes a byline like ["Artist", " • ", "Album", " • ", "3:45"]
// and returns just the artist part(s).
func artistFromByline(runs []string) string {
	a, _, _ := splitSubtitle(runs)
	return a
}

// splitSubtitle parses the " • "-separated subtitle used in search rows:
// "Song • Artist • Album • 3:45". The leading "Song" token is optional.
func splitSubtitle(runs []string) (artist, album string, duration int) {
	var parts []string
	var cur strings.Builder
	for _, r := range runs {
		if strings.TrimSpace(r) == "•" {
			parts = append(parts, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteString(r)
	}
	parts = append(parts, strings.TrimSpace(cur.String()))

	// Drop a leading type label ("Song", "Video", "Lagu", …) if present.
	if len(parts) > 1 && isTypeLabel(parts[0]) {
		parts = parts[1:]
	}
	// Trailing duration.
	if len(parts) > 0 {
		if d := parseDuration(parts[len(parts)-1]); d > 0 {
			duration = d
			parts = parts[:len(parts)-1]
		}
	}
	if len(parts) > 0 {
		artist = parts[0]
	}
	if len(parts) > 1 {
		album = parts[1]
	}
	return
}

func isTypeLabel(s string) bool {
	switch rowLabel(strings.ToLower(s)) {
	case labelSong, labelLagu, labelVideo, labelEpisode, labelSingle, labelAlbum, labelPlaylist, labelArtist:
		return true
	}
	return false
}

// musicVideoType is how YouTube classifies a playable row. Songs are
// MUSIC_VIDEO_TYPE_ATV; they need nothing special.
type musicVideoType string

const (
	videoTypeOfficialVideo  musicVideoType = "MUSIC_VIDEO_TYPE_OMV"
	videoTypeOfficialSource musicVideoType = "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC"
	videoTypeUpload         musicVideoType = "MUSIC_VIDEO_TYPE_UGC"
)

// isVideo reports whether t is a music video or an upload rather than a song.
func (t musicVideoType) isVideo() bool {
	switch t {
	case videoTypeOfficialVideo, videoTypeOfficialSource, videoTypeUpload:
		return true
	}
	return false
}

// videoTypeOf reads a row's type, which its title and play button both carry.
func videoTypeOf(row node) musicVideoType {
	var t musicVideoType
	// walk switches on map[string]any, so the named node type must be unwrapped.
	walk(map[string]any(row), "watchEndpointMusicConfig", func(c node) {
		t = musicVideoType(c.str("musicVideoType"))
	})
	return t
}

// parseDuration turns "3:45" or "1:02:03" into seconds; 0 if not a duration.
func parseDuration(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0
	}
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}
