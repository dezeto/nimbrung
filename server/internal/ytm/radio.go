package ytm

import (
	"context"
	"encoding/json"
)

// radioPrefix turns a videoId into the playlist YouTube Music plays for
// "Start radio" on that song.
const radioPrefix = "RDAMVM"

// Radio is YouTube Music's song radio for videoID: songs like that one,
// without it. Unlike Autoplay, which guesses what follows the whole queue,
// this is seeded by one song, so "More like what's playing" means it. Asked
// anonymously and remembered for the night; empty, never an error, when
// YouTube has none or can't be reached.
func (c *Client) Radio(ctx context.Context, videoID string) []Track {
	if tracks, ok := c.radios.get(videoID); ok {
		return tracks
	}
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	raw, err := c.youtubei(ctx, "next", map[string]any{"videoId": videoID, "playlistId": radioPrefix + videoID})
	if err != nil {
		c.log.Debug("no song radio", "videoId", videoID, "err", err)
		return nil // not remembered: the next ask may get through
	}
	tracks, _ := parseRadio(raw, videoID)
	c.radios.put(videoID, tracks)
	return tracks
}

// parseRadio reads the songs of a radio's queue panel, minus its seed (the
// first row, and sometimes again later) and repeats.
func parseRadio(raw json.RawMessage, seed string) ([]Track, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	seen := map[string]bool{seed: true}
	var tracks []Track
	walk(root, "playlistPanelVideoRenderer", func(r node) {
		t := panelTrack(r)
		if t.VideoID == "" || t.Title == "" || seen[t.VideoID] {
			return
		}
		seen[t.VideoID] = true
		t.Album = albumTitle(r.obj("longBylineText"))
		if t.Thumb == "" {
			// Some radio rows come without art; the video's own still always
			// exists, and the web zooms past its letterbox bars.
			t.Thumb = "https://i.ytimg.com/vi/" + t.VideoID + "/hqdefault.jpg"
		}
		tracks = append(tracks, t)
	})
	return tracks, nil
}
