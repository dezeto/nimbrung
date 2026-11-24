// Package ytm is a thin client for the "API Server" plugin of the YouTube
// Music desktop app (pear-devs/pear-desktop, formerly th-ch/youtube-music).
//
// Only the endpoints Nimbrung needs are wrapped. Everything the plugin
// returns in YouTube's raw InnerTube shape (search results, queue) is
// normalised here into small, stable structs so the rest of the app never
// touches InnerTube JSON.
package ytm

// Track is a song as Nimbrung understands it, regardless of which plugin
// endpoint it came from.
type Track struct {
	VideoID  string `json:"videoId"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	ArtistID string `json:"artistId,omitempty"` // the first artist's channel, "UC…"; "" when the row links none
	Album    string `json:"album,omitempty"`
	Thumb    string `json:"thumb,omitempty"`
	Duration int    `json:"duration"` // seconds, 0 if unknown
}

// NowPlaying is the current song plus playback position.
type NowPlaying struct {
	Track
	Elapsed  int  `json:"elapsed"` // seconds
	IsPaused bool `json:"isPaused"`
}

// Volume is how loud the player is, 0–100, and whether it's muted.
type Volume struct {
	Level int  `json:"level"`
	Muted bool `json:"muted"`
}

// QueueItem is one row of the player's queue.
type QueueItem struct {
	Track
	Index    int  `json:"index"`
	Selected bool `json:"selected"` // true for the row currently playing
}

// SearchKind picks the YouTube Music search filter. The values travel as
// GET /api/search?type=; the web UI's SearchKind enum must match them.
type SearchKind string

const (
	SearchSongs     SearchKind = "songs"
	SearchVideos    SearchKind = "videos"
	SearchPlaylists SearchKind = "playlists"
	SearchArtists   SearchKind = "artists"
)

// Artist is an artist in search results; Client.Artist opens them.
type Artist struct {
	ID    string `json:"id"` // YouTube's channel ID, "UC…"
	Name  string `json:"name"`
	Thumb string `json:"thumb,omitempty"`
}

// ArtistPage is an artist and their songs, most played first: YouTube's
// first page, up to 100 of them.
type ArtistPage struct {
	Artist
	Tracks []Track `json:"tracks"`
}

// Playlist is a playlist in search results; Client.Playlist opens it.
type Playlist struct {
	ID     string `json:"id"` // YouTube's playlistId, "PL…"
	Title  string `json:"title"`
	Author string `json:"author,omitempty"`
	Thumb  string `json:"thumb,omitempty"`
}

// PlaylistPage is a playlist's title and songs: YouTube's first page, up to
// 100 of them.
type PlaylistPage struct {
	Title  string  `json:"title"`
	Tracks []Track `json:"tracks"`
}

// SearchRequest asks for one page of results. Cursor is the previous page's
// Next; empty for the first page.
type SearchRequest struct {
	Query  string
	Kind   SearchKind
	Cursor string
}

// SearchPage is one page of results. Next is empty on the last page;
// CorrectedQuery is set when YouTube fixed a typo and searched for that.
type SearchPage struct {
	Tracks         []Track    `json:"tracks"`
	Playlists      []Playlist `json:"playlists,omitempty"`
	Artists        []Artist   `json:"artists,omitempty"`
	Next           string     `json:"next,omitempty"`
	CorrectedQuery string     `json:"correctedQuery,omitempty"`
}

// InsertPosition controls where the plugin adds a song.
type InsertPosition string

const (
	InsertAtEnd             InsertPosition = "INSERT_AT_END"
	InsertAfterCurrentVideo InsertPosition = "INSERT_AFTER_CURRENT_VIDEO"
)
