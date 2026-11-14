package ytm

import "context"

// Playlist asks YouTube for a playlist's songs, anonymously like Autoplay,
// so only public and unlisted playlists open. The plugin has no endpoint for
// it.
func (c *Client) Playlist(ctx context.Context, id string) (PlaylistPage, error) {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "browse", map[string]any{"browseId": "VL" + id})
	if err != nil {
		return PlaylistPage{}, err
	}
	return parsePlaylist(raw)
}
