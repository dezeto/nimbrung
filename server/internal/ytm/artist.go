package ytm

import (
	"context"
	"sync"
	"time"
)

// Artists, albums, their songs and search suggestions come from YouTube
// anonymously, like Playlist: the plugin has no endpoint for them, and an
// anonymous call doesn't wait its turn behind the guests' searches.

// suggestTimeout is short: a suggestion that arrives late is one nobody reads.
const suggestTimeout = 3 * time.Second

// maxSuggestions is how many fit in one row of chips before nobody scrolls.
const maxSuggestions = 6

// pageCacheSize is how many artists, or albums, are remembered: a night's worth.
const pageCacheSize = 200

// pageCache remembers artist and album pages for the life of the jam: every
// guest's search screen asks for the artists in the queue, an artist page
// costs YouTube two calls, and an album page is opened by everyone a guest
// shows it to.
type pageCache[T any] struct {
	mu    sync.Mutex
	pages map[string]T
}

func (c *pageCache[T]) get(id string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	page, ok := c.pages[id]
	return page, ok
}

func (c *pageCache[T]) put(id string, page T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Full means start over: simpler than tracking which page is oldest,
	// and a jam doesn't browse 200 of them.
	if c.pages == nil || len(c.pages) >= pageCacheSize {
		c.pages = map[string]T{}
	}
	c.pages[id] = page
}

// searchYouTube asks YouTube itself for one page of results. A "More
// results" cursor goes along with the query and filter, as the web player
// sends it.
func (c *Client) searchYouTube(ctx context.Context, req SearchRequest) (SearchPage, error) {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	fields := map[string]any{"query": req.Query, "params": req.Kind.filter()}
	if req.Cursor != "" {
		fields["continuation"] = req.Cursor
	}
	raw, err := c.youtubei(ctx, "search", fields)
	if err != nil {
		return SearchPage{}, err
	}
	return parseSearch(raw)
}

// Artist asks YouTube for an artist's name, photo and songs. A page without
// a name isn't an artist; it comes back empty and isn't remembered.
func (c *Client) Artist(ctx context.Context, id string) (ArtistPage, error) {
	if page, ok := c.artists.get(id); ok {
		return page, nil
	}
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "browse", map[string]any{"browseId": id})
	if err != nil {
		return ArtistPage{}, err
	}
	page, songs, err := parseArtist(raw)
	if err != nil || page.Name == "" {
		return ArtistPage{}, err
	}
	page.ID = id
	for i := range page.Albums {
		page.Albums[i].Artist, page.Albums[i].ArtistID = page.Name, id
	}
	// The artist's own page shows five songs without durations; the playlist
	// behind its "Top songs" has the rest. If that fails, five is still an answer.
	if songs != "" {
		if all, err := c.Playlist(ctx, songs); err == nil && len(all.Tracks) > 0 {
			page.Tracks = all.Tracks
		}
	}
	c.artists.put(id, page)
	return page, nil
}

// Album asks YouTube for an album's title, artist, art and songs. A page
// without a title isn't an album; it comes back empty and isn't remembered.
func (c *Client) Album(ctx context.Context, id string) (AlbumPage, error) {
	if page, ok := c.albums.get(id); ok {
		return page, nil
	}
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "browse", map[string]any{"browseId": id})
	if err != nil {
		return AlbumPage{}, err
	}
	page, err := parseAlbum(raw)
	if err != nil || page.Title == "" {
		return AlbumPage{}, err
	}
	page.ID = id
	c.albums.put(id, page)
	return page, nil
}

// FindTrack asks YouTube what a video is, for a link a guest pasted: the
// next endpoint answers with the video first, as the player it starts.
func (c *Client) FindTrack(ctx context.Context, videoID string) (Track, error) {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "next", map[string]any{"videoId": videoID})
	if err != nil {
		return Track{}, err
	}
	return parseTrack(raw, videoID)
}

// Suggest returns ways to finish what a guest has typed so far; empty, never
// an error, when YouTube has none or can't be reached.
func (c *Client) Suggest(ctx context.Context, input string) []string {
	ctx, cancel := context.WithTimeout(ctx, suggestTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "music/get_search_suggestions", map[string]any{"input": input})
	if err != nil {
		c.log.Debug("no search suggestions", "err", err)
		return nil
	}
	suggestions, _ := parseSuggestions(raw)
	if len(suggestions) > maxSuggestions {
		suggestions = suggestions[:maxSuggestions]
	}
	return suggestions
}
