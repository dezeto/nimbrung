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
		ArtistID: artistID(r.obj("longBylineText")),
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
		if a, ok := artistRow(r); ok {
			if !seen[a.ID] {
				seen[a.ID] = true
				page.Artists = append(page.Artists, a)
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
	t.ArtistID = artistID(flexColumn(r, 1))
	// A playlist's rows give the album and the duration columns of their own.
	// The album is the last one: an artist's songs have a play count before it.
	if fixed := r.list("fixedColumns"); len(fixed) > 0 {
		if cols := len(r.list("flexColumns")); t.Album == "" && cols > 2 {
			t.Album = flexColumn(r, cols-1).runsText()
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

// The page types a row or a byline link opens.
const (
	musicPagePlaylist = "MUSIC_PAGE_TYPE_PLAYLIST"
	musicPageArtist   = "MUSIC_PAGE_TYPE_ARTIST"
)

// pageTypeOf is the kind of page a browse link opens.
func pageTypeOf(browse node) string {
	return browse.obj("browseEndpointContextSupportedConfigs").obj("browseEndpointContextMusicConfig").str("pageType")
}

// artistID is the channel of the first artist a byline links to; "" when it
// links none, as uploads and some videos don't.
func artistID(byline node) string {
	for _, run := range byline.list("runs") {
		browse := run.obj("navigationEndpoint").obj("browseEndpoint")
		if pageTypeOf(browse) == musicPageArtist {
			return browse.str("browseId")
		}
	}
	return ""
}

// artistRow reads an artist row of a search page: "Name" over
// "Artist • 53.7M monthly audience".
func artistRow(r node) (Artist, bool) {
	browse := r.obj("navigationEndpoint").obj("browseEndpoint")
	a := Artist{ID: browse.str("browseId"), Name: flexColumn(r, 0).runsText(), Thumb: squareThumb(rowThumb(r))}
	return a, pageTypeOf(browse) == musicPageArtist && a.ID != "" && a.Name != ""
}

// parseArtist extracts an artist's name, photo and first few songs from
// YouTube's raw browse response for their channel, plus the playlist that
// holds all their songs ("" when the page links none).
func parseArtist(raw json.RawMessage) (ArtistPage, string, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return ArtistPage{}, "", err
	}
	var page ArtistPage
	// Big artists get the immersive header, the rest the visual one.
	for _, header := range []string{"musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer"} {
		walk(root, header, func(h node) {
			page.Name = h.obj("title").runsText()
			page.Thumb = squareThumb(rowThumb(h))
		})
	}
	// Only the first shelf is their songs; the ones after it are albums,
	// videos and other artists.
	var songs string
	seen := map[string]bool{}
	sections := node{}
	walk(root, "sectionListRenderer", func(s node) { sections = s })
	for _, section := range sections.list("contents") {
		shelf := section.obj("musicShelfRenderer")
		if shelf == nil {
			continue
		}
		songs, _ = strings.CutPrefix(shelf.obj("bottomEndpoint").obj("browseEndpoint").str("browseId"), "VL")
		walk(map[string]any(shelf), "musicResponsiveListItemRenderer", func(r node) {
			if t, ok := trackRow(r); ok && !seen[t.VideoID] {
				seen[t.VideoID] = true
				page.Tracks = append(page.Tracks, t)
			}
		})
		break
	}
	return page, songs, nil
}

// parseSuggestions extracts the ways YouTube would finish what was typed.
func parseSuggestions(raw json.RawMessage) ([]string, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	var out []string
	walk(root, "searchSuggestionRenderer", func(s node) {
		if text := s.obj("suggestion").runsText(); text != "" {
			out = append(out, text)
		}
	})
	return out, nil
}

// playlistRow reads a playlist row of a search page: "Title" over
// "Author • 11M views".
func playlistRow(r node) (Playlist, bool) {
	browse := r.obj("navigationEndpoint").obj("browseEndpoint")
	id, ok := strings.CutPrefix(browse.str("browseId"), "VL")
	if pageTypeOf(browse) != musicPagePlaylist || !ok || id == "" {
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

// artistPhotoSize is the side, in pixels, artist photos are asked for: a
// 72px circle on a 3x phone.
const artistPhotoSize = 240

// squareThumb asks Google's image host for a square, face-centred crop of a
// photo: artist rows come 120px wide and artist headers as wide banners, and
// the size is the "=w…" tail of the URL. Other hosts' URLs pass through.
func squareThumb(url string) string {
	base, _, sized := strings.Cut(url, "=w")
	if !sized || !strings.Contains(base, ".googleusercontent.com/") {
		return url
	}
	px := strconv.Itoa(artistPhotoSize)
	return base + "=w" + px + "-h" + px + "-p-l90-rj"
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
