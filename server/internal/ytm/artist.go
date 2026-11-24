package ytm

import (
	"context"
	"sync"
	"time"
)

// Artists, their songs and search suggestions come from YouTube anonymously,
// like Playlist: the plugin has no endpoint for them, and an anonymous call
// doesn't wait its turn behind the guests' searches.

// artistsFilter is the Artists search filter, built like songsFilter.
const artistsFilter = "EgWKAQIgAWoMEA4QChADEAQQCRAF"

// suggestTimeout is short: a suggestion that arrives late is one nobody reads.
const suggestTimeout = 3 * time.Second

// maxSuggestions is how many fit in one row of chips before nobody scrolls.
const maxSuggestions = 6

// artistCacheSize is how many artists are remembered: a night's worth.
const artistCacheSize = 200

// artistCache remembers artist pages for the life of the jam: every guest's
// search screen asks for the artists in the queue, and each answer costs
// YouTube two calls.
type artistCache struct {
	mu    sync.Mutex
	pages map[string]ArtistPage
}

func (c *artistCache) get(id string) (ArtistPage, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	page, ok := c.pages[id]
	return page, ok
}

func (c *artistCache) put(id string, page ArtistPage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Full means start over: simpler than tracking which artist is oldest,
	// and a jam doesn't browse 200 of them.
	if c.pages == nil || len(c.pages) >= artistCacheSize {
		c.pages = map[string]ArtistPage{}
	}
	c.pages[id] = page
}

// searchArtists asks YouTube for the artists matching a query.
func (c *Client) searchArtists(ctx context.Context, query string) (SearchPage, error) {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "search", map[string]any{"query": query, "params": artistsFilter})
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
