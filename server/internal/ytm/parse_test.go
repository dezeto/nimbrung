package ytm

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestParseSearch(t *testing.T) {
	raw := `{"contents":{"tabbedSearchResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
	 {"musicShelfRenderer":{"contents":[
	  {"musicResponsiveListItemRenderer":{
	    "playlistItemData":{"videoId":"abc123"},
	    "thumbnail":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"small.jpg","width":60},{"url":"big.jpg","width":120}]}}},
	    "flexColumns":[
	      {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Die With A Smile"}]}}},
	      {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Song"},{"text":" • "},{"text":"Lady Gaga"},{"text":" & "},{"text":"Bruno Mars"},{"text":" • "},{"text":"Die With A Smile"},{"text":" • "},{"text":"4:11"}]}}}
	    ]}},
	  {"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"abc123"},"flexColumns":[{"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"dup"}]}}}]}}
	 ]}}]}}}}]}}}`

	page, err := parseSearch(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	got := page.Tracks
	if len(got) != 1 {
		t.Fatalf("want 1 track (deduped), got %d", len(got))
	}
	tr := got[0]
	if tr.VideoID != "abc123" || tr.Title != "Die With A Smile" {
		t.Errorf("bad id/title: %+v", tr)
	}
	if tr.Artist != "Lady Gaga & Bruno Mars" {
		t.Errorf("artist = %q", tr.Artist)
	}
	if tr.Album != "Die With A Smile" || tr.Duration != 251 || tr.Thumb != "big.jpg" {
		t.Errorf("album/duration/thumb: %+v", tr)
	}
}

// Shapes captured from a live "coldplay" search, Oct 2026.
func TestParseSearchFillsTopResultArtistAndDropsEpisodes(t *testing.T) {
	raw := `{"contents":{"tabbedSearchResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
	 {"musicCardShelfRenderer":{
	   "title":{"runs":[{"text":"Coldplay"}]},
	   "subtitle":{"runs":[{"text":"Artist"},{"text":" • "},{"text":"351M monthly audience"}]},
	   "contents":[{"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"top1"},"flexColumns":[
	     {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Something Just Like This"}]}}},
	     {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Song"},{"text":" • "},{"text":"4:08"}]}}}
	   ]}}]}},
	 {"musicShelfRenderer":{"contents":[
	  {"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"ep1"},"flexColumns":[
	    {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Some podcast talk"}]}}},
	    {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Episode"},{"text":" • "},{"text":"1d ago"},{"text":" • "},{"text":"BRDO"}]}}}
	  ]}}
	 ]}}]}}}}]}}}`

	page, err := parseSearch(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	got := page.Tracks
	if len(got) != 1 {
		t.Fatalf("want 1 track (episode dropped), got %d: %+v", len(got), got)
	}
	if tr := got[0]; tr.VideoID != "top1" || tr.Artist != "Coldplay" || tr.Duration != 248 {
		t.Errorf("top result row: %+v", tr)
	}
}

// The testdata pages are live "bohemian rhapsody" searches through pear-desktop
// 3.12.0 (Oct 2026), trimmed to a few rows and the fields parse.go reads.
// Continuation tokens are opaque, so they're replaced with readable names.
func TestParseSearchLiveCaptures(t *testing.T) {
	queen := Track{VideoID: "BSTsnWoslP4", Title: "Bohemian Rhapsody", Artist: "Queen", Album: "A Night At The Opera", Duration: 355}
	martel := Track{VideoID: "SjERDqnbmiA", Title: "Bohemian Rhapsody", Artist: "Marc Martel", Album: "Thunderbolt and Lightning", Duration: 358}
	mashup := Track{VideoID: "_Xsu44ppnFQ", Title: "Bohemian Rhapsody x Walk It Talk It", Artist: "nimphia & klyron", Album: "Bohemian Rhapsody x Walk It Talk It", Duration: 114}
	wembley := "Bohemian Rhapsody (Live At Wembley Stadium / July 1986)"

	cases := []struct {
		name, fixture string
		want          SearchPage
	}{
		{"songs carry artist, album, duration and the next page", "search_songs.json", SearchPage{
			Tracks: []Track{queen, martel, mashup},
			Next:   "songs-page-2",
		}},
		{"a More results page reads like the first, repeats included", "search_songs_more.json", SearchPage{
			Tracks: []Track{
				{VideoID: "001WSZT0NG4", Title: "Bohemian Rhapsody (Live)", Artist: "God Save the Queen", Album: "Bohemian Rhapsody (Live)", Duration: 336},
				mashup,
				{VideoID: "Qd8DtYYloE8", Title: "Bohemian Rhapsody (Piano Arrangement)", Artist: "Costantino Carrara", Album: "Bohemian Rhapsody (Piano Arrangement)", Duration: 344},
			},
			Next: "songs-page-3",
		}},
		{"videos carry the channel and no album, not the view count", "search_videos.json", SearchPage{
			Tracks: []Track{
				{VideoID: "fJ9rUzIMcZQ", Title: wembley, Artist: "Queen", Duration: 360},
				{VideoID: "dthAWAIDkog", Title: "LYKN (WILLIAM) - Bohemian Rhapsody @LYKN REFLEXION CONCERT Day1 - 23 Oct 2026 [4K]", Artist: "ChocolatezB", Duration: 379},
				{VideoID: "_j4KIDFtpcA", Title: "Bohemian Rhapsody", Artist: "Forestella", Duration: 368},
			},
			Next: "videos-page-2",
		}},
		{"a fixed typo reports the corrected query", "search_typo.json", SearchPage{
			Tracks:         []Track{queen, martel},
			Next:           "typo-page-2",
			CorrectedQuery: "bohemian rhapsody",
		}},
		// A live "lofi chill" search with the Playlists filter, Oct 2026.
		{"playlists carry their ID without VL and the author, not the views", "search_playlists.json", SearchPage{
			Playlists: []Playlist{
				{ID: "PLRhpz_QE8rmYXE_sC2YjcP_hll-vIy1Xy", Title: "Nhạc Lofi Gây Nghiện Hay Nhất 2021 | Lofi Chill 2021", Author: "Tiệm Nhạc Lofi",
					Thumb: "https://i.ytimg.com/vi/rIhXRRlvD9E/hq720.jpg?sqp=-oaymwEKCNUGEN8DIABIWg&rs=AMzJL3ltS3flE091dbxrOysSEfXUU95AEw"},
				{ID: "PLl578ZPbYIlFcSxuka8Km37VgbUYUWI5p", Title: "Anime Lo-fi", Author: "Kijugo",
					Thumb: "https://yt3.googleusercontent.com/YPrbHMbnyRqT4aUOEBDaJg3ddzzCjISyhxlS0NlvAMV9wwNk8q-_cnejxb_0KdV9cBO-UqjoaFQ=s1200"},
				{ID: "PLtPxndKI0wYK47ly9SHKbf9fttP_PFzt3", Title: "Nhạc Lofi Chill Tiktok - Bụi Chill", Author: "Bụi Chill",
					Thumb: "https://i.ytimg.com/vi/Z2oN7nVtclQ/hq720.jpg?sqp=-oaymwEKCNUGEN8DIABIWg&rs=AMzJL3kdD5RGWpKny5ehZRRrEJWP_knJ4g"},
			},
			Next: "playlists-page-2",
		}},
		{"the unfiltered layout drops episodes and video albums and has no next page", "search_plain.json", SearchPage{
			Tracks: []Track{
				{VideoID: "nV8sePyzZkk", Title: "Bohemian Rhapsody", Artist: "Ahmad Dhani & Philharmonic Orchestra"},
				{VideoID: "fJ9rUzIMcZQ", Title: wembley, Artist: "Queen"},
			},
		}},
	}
	for _, c := range cases {
		raw, err := os.ReadFile(filepath.Join("testdata", c.fixture))
		if err != nil {
			t.Fatal(err)
		}
		got, err := parseSearch(raw)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %+v\nwant %+v", c.name, got, c.want)
		}
	}
}

// browse_playlist.json is a live anonymous browse of the "Anime Lo-fi"
// playlist (Oct 2026), trimmed to three of its 54 rows and the fields
// parse.go reads.
func TestParsePlaylist(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "browse_playlist.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := PlaylistPage{Title: "Anime Lo-fi", Tracks: []Track{
		{VideoID: "uk_wKYFLO0I", Title: "River but is it okay if it's lofi?", Artist: "Kijugo", Duration: 185,
			Thumb: "https://i.ytimg.com/vi/uk_wKYFLO0I/hqdefault.jpg?sqp=-oaymwEWCJADEOEBIAQqCggAEOADGC0guwJIWg&rs=AMzJL3mFA2yJ7n2Qmue1K0f_b9yETyIwiQ"},
		{VideoID: "pqdgpIlwlVo", Title: "Bloody Stream but is it okay if it's lofi?", Artist: "Kijugo", Duration: 214,
			Thumb: "https://i.ytimg.com/vi/pqdgpIlwlVo/hqdefault.jpg?sqp=-oaymwEWCJADEOEBIAQqCggAEOADGC0guwJIWg&rs=AMzJL3n3UY_4TNYET4txkTiBfOZgAGxMFA"},
		{VideoID: "R9W-qJsTgsI", Title: "Idol but is it okay if it's lofi?", Artist: "Kijugo & Venvn", Duration: 104,
			Thumb: "https://i.ytimg.com/vi/R9W-qJsTgsI/hqdefault.jpg?sqp=-oaymwEWCJADEOEBIAQqCggAEOADGC0guwJIWg&rs=AMzJL3m5P5o7fKzZnVoYraxm-o-epelB6w"},
	}}
	got, err := parsePlaylist(live)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, %v\nwant %+v", got, err, want)
	}
}

func TestParseQueue(t *testing.T) {
	raw := `{"items":[
	 {"playlistPanelVideoRenderer":{"videoId":"v1","selected":true,"title":{"runs":[{"text":"One"}]},"longBylineText":{"runs":[{"text":"Artist A"},{"text":" • "},{"text":"Album"},{"text":" • "},{"text":"3:00"}]},"lengthText":{"runs":[{"text":"3:00"}]},"thumbnail":{"thumbnails":[{"url":"t1","width":100}]}}},
	 {"playlistPanelVideoWrapperRenderer":{"primaryRenderer":{"playlistPanelVideoRenderer":{"videoId":"v2","title":{"runs":[{"text":"Two"}]},"longBylineText":{"runs":[{"text":"Artist B"}]}}}}}
	]}`
	got, _, err := parseQueue(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	if !got[0].Selected || got[0].VideoID != "v1" || got[0].Artist != "Artist A" || got[0].Duration != 180 {
		t.Errorf("row0: %+v", got[0])
	}
	if got[1].Index != 1 || got[1].VideoID != "v2" || got[1].Artist != "Artist B" {
		t.Errorf("row1: %+v", got[1])
	}
}

// next_autoplay.json is a live anonymous next call for a queue's continuation
// token (Oct 2026), trimmed to three of its 49 rows and the fields parse.go
// reads.
func TestParseAutoplay(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "next_autoplay.json"))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		raw  []byte
		want []Track
	}{
		{"songs carry artist, duration and the biggest thumb, not the year", live, []Track{
			{VideoID: "LnNUYNRcfgM", Title: "carry you away (demo)", Artist: "Michael Clifford", Duration: 184,
				Thumb: "https://yt3.googleusercontent.com/kcutS6FBerUwItdA_r9_T0sSUuNHk5Jgi4DOHaiX4n1R15ncXarr6kmK_4P-iOTOW_ND6mcOZ11-Wz-4xQ=w544-h544-l90-rj"},
			{VideoID: "gnN_jiesIkM", Title: "Steal My Girl", Artist: "One Direction", Duration: 229,
				Thumb: "https://yt3.googleusercontent.com/fyfca39b6OXF-CpPJqI9ykwo9djxZROQcbAMfnO-oE7Yr4PLxpWZazQjW49qpW2I293WC6_ddDQyHe4=w544-h544-l90-rj"},
			{VideoID: "ZkPYd2HzSpE", Title: "Jet Lag (feat. Natasha Bedingfield)", Artist: "Simple Plan", Duration: 205,
				Thumb: "https://yt3.googleusercontent.com/RcQrBiHVFONkaHzbSBJzyw8iWcF3rigcgotzZOBJY-vtB3IZmH0-rfZUyoJizqr6jjZf1TKYREQpK6Om=w544-h544-l90-rj"},
		}},
		{"a reshaped answer gives no songs, not an error", []byte(`{"contents":{"playlistPanelVideoRenderer":{"videoId":"elsewhere"}}}`), nil},
	}
	for _, c := range cases {
		got, err := parseAutoplay(c.raw)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %+v, %v\nwant %+v", c.name, got, err, c.want)
		}
	}
}

func TestParseDuration(t *testing.T) {
	cases := map[string]int{"3:45": 225, "1:02:03": 3723, "": 0, "abc": 0, "12": 0}
	for in, want := range cases {
		if got := parseDuration(in); got != want {
			t.Errorf("parseDuration(%q) = %d, want %d", in, got, want)
		}
	}
}
