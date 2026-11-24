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
		{"videos carry the channel and the view count where songs have the album", "search_videos.json", SearchPage{
			Tracks: []Track{
				{VideoID: "fJ9rUzIMcZQ", Title: wembley, Artist: "Queen", Views: "2.1B views", Duration: 360},
				{VideoID: "dthAWAIDkog", Title: "LYKN (WILLIAM) - Bohemian Rhapsody @LYKN REFLEXION CONCERT Day1 - 23 Oct 2026 [4K]", Artist: "ChocolatezB", Views: "36K views", Duration: 379},
				{VideoID: "_j4KIDFtpcA", Title: "Bohemian Rhapsody", Artist: "Forestella", Views: "6.1M views", Duration: 368},
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
				{VideoID: "fJ9rUzIMcZQ", Title: wembley, Artist: "Queen", Views: "2.1B views"},
			},
		}},
		// A live anonymous "abbey road" search with the Albums filter, Nov 2026.
		{"albums carry kind, artist and year, and aren't read as songs or playlists", "search_albums.json", SearchPage{
			Albums: []Album{
				{ID: "MPREb_LQwx7Jq6u9H", Title: "Abbey Road (2019 Mix)", Artist: "The Beatles", ArtistID: "UC2XdaAVUannpujzv32jcouQ", Year: "1969", Kind: "Album",
					Thumb: "https://yt3.googleusercontent.com/VXxc8oK7A7SGIY-hueFohH1Kd361e8UiMZXnKb2rpKTYaR-UgdTE07LyoGeQ30vpwEr6nlx1f2Fycvr0=w264-h264-p-l90-rj"},
				{ID: "MPREb_augylbAw3Jc", Title: "Love Goes (Live at Abbey Road Studios)", Artist: "Sam Smith", ArtistID: "UCgpBsaDW2n_6ruzht3wvP0A", Year: "2021", Kind: "Album",
					Thumb: "https://yt3.googleusercontent.com/eRzY6pzQEB3PtZZzS2kZJgG-1rNe4UwDcI3EMoTroPfB-pAh3SuaBMoYVEilMpYeTj-Gy_RdqRwErrrnJg=w264-h264-p-l90-rj"},
				{ID: "MPREb_8ZK2auRO6dy", Title: "Abbey Road", Artist: "Gabriella Kaye", ArtistID: "UC0Z3hjNu41byF-XO1c4f8kQ", Year: "2026", Kind: "Single",
					Thumb: "https://yt3.googleusercontent.com/Jxe8Q3sITZR5iikpbhdJYtL_Vkjx8E65zo0HBkYXPkGwR-St5GfEXpApKZm0SIJqYbRG2m4NDxGaQ94=w264-h264-p-l90-rj"},
			},
			Next: "albums-page-2",
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

// search_artists.json is a live anonymous "tulus" search with the Artists
// filter (Nov 2026), trimmed to two rows and the fields parse.go reads.
func TestParseSearchReadsArtistRows(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "search_artists.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := []Artist{
		{ID: "UC_DHlXllTSMB8pTC38_leFg", Name: "Tulus",
			Thumb: "https://yt3.googleusercontent.com/h8P1jEIZLM8lkMxNA6Nbq98b43wcqllJSNmcZTCRPAB-F6rG_0Nqw5w7fwou0PN1QGwSW5viwWD5NV0=w240-h240-p-l90-rj"},
		{ID: "UCbwAI7LydeNSRU-bywK0EHw", Name: "Nadhif Basalamah",
			Thumb: "https://yt3.googleusercontent.com/jjFbDHc_GFI6lVSSRPGWMrh71fJ16iZYMccLFbkN_Jq6uR-QYXzgRwFDSuZeDpOuAbIIzNnPAPDZgAHv=w240-h240-p-l90-rj"},
	}
	got, err := parseSearch(live)
	if err != nil || !reflect.DeepEqual(got.Artists, want) || len(got.Tracks) != 0 {
		t.Errorf("got %+v, %v\nwant artists %+v and no songs", got, err, want)
	}
}

// browse_artist.json is a live anonymous browse of Tulus's channel (Nov
// 2026), trimmed to its header, two of the five songs on its first shelf,
// and a tile or two from each shelf after it.
func TestParseArtist(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "browse_artist.json"))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name       string
		raw        []byte
		wantName   string
		wantThumb  string
		wantSongs  string
		wantIDs    []string
		wantAlbums []Album
	}{
		{"name, a square photo, the first shelf's songs and the playlist behind it, then albums and singles but not videos, playlists or artists", live, "Tulus",
			"https://yt3.googleusercontent.com/h8P1jEIZLM8lkMxNA6Nbq98b43wcqllJSNmcZTCRPAB-F6rG_0Nqw5w7fwou0PN1QGwSW5viwWD5NV0=w240-h240-p-l90-rj",
			"OLAK5uy_mHgw7gB4UOePEByyIUPoXcCIWTbVade7w", []string{"5F28ye50-Kc", "qrnJL6P-QqQ"}, []Album{
				{ID: "MPREb_7FNmIeIV9kf", Title: "Manusia", Year: "2022", Kind: "Album",
					Thumb: "https://yt3.googleusercontent.com/0LkNos-al_3gRdfeVnsoULGEInj8_1uQkE4p9nT_6heSYKzO2emQrqm-XcexNEhl_sfTueS-gT45yoQ=w264-h264-p-l90-rj"},
				{ID: "MPREb_4TEBtGA3cZb", Title: "Monokrom", Year: "2016", Kind: "Album",
					Thumb: "https://yt3.googleusercontent.com/SJTWzxOnk0D_TIfYfkcIUzlYbSB5P8QtPYfdjRt3cBeyMk-0cuxdxTIXYp45ghLEhjEvnUpakX8scPgN=w264-h264-p-l90-rj"},
				{ID: "MPREb_RVAbNZdUasD", Title: "Teh Hijau", Year: "2026", Kind: "Single",
					Thumb: "https://yt3.googleusercontent.com/xrGDyYO3umAVFdsdyIM2G451xiAxCD6haJkCQel6TQlqE-XsEUCGsj_Q5Er4YjFpjWqv-_Ze-VaPPL0j=w264-h264-p-l90-rj"},
				{ID: "MPREb_FKsUDydW3qF", Title: "Adaptasi", Year: "2020", Kind: "Single",
					Thumb: "https://yt3.googleusercontent.com/vNgubMQUiW7RRLYNMVHuLpeC1Z2LahUFsdqpnJ6A-wFnIqBmN5WzKqxf_-RDhvgr_DOsho9iYXbbETCNxg=w264-h264-p-l90-rj"},
			}},
		{"a page that isn't an artist has no name", []byte(`{"contents":{}}`), "", "", "", nil, nil},
	}
	for _, c := range cases {
		page, songs, err := parseArtist(c.raw)
		var ids []string
		for _, track := range page.Tracks {
			ids = append(ids, track.VideoID)
		}
		if err != nil || page.Name != c.wantName || page.Thumb != c.wantThumb || songs != c.wantSongs || !reflect.DeepEqual(ids, c.wantIDs) {
			t.Errorf("%s:\n got %q %q songs=%q %v, %v", c.name, page.Name, page.Thumb, songs, ids, err)
		}
		if !reflect.DeepEqual(page.Albums, c.wantAlbums) {
			t.Errorf("%s:\n got albums %+v\nwant %+v", c.name, page.Albums, c.wantAlbums)
		}
	}
}

// browse_album.json is a live anonymous browse of "Abbey Road (2019 Mix)"
// (Nov 2026), trimmed to its header, three of its 17 songs and one tile of
// the "Releases for you" shelf under them.
func TestParseAlbum(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "browse_album.json"))
	if err != nil {
		t.Fatal(err)
	}
	art := "https://yt3.googleusercontent.com/VXxc8oK7A7SGIY-hueFohH1Kd361e8UiMZXnKb2rpKTYaR-UgdTE07LyoGeQ30vpwEr6nlx1f2Fycvr0=w544-h544-l90-rj"
	beatles := "UC2XdaAVUannpujzv32jcouQ"
	song := func(id, title string, duration int) Track {
		return Track{VideoID: id, Title: title, Artist: "The Beatles", ArtistID: beatles, Album: "Abbey Road (2019 Mix)", Thumb: art, Duration: duration}
	}
	cases := []struct {
		name string
		raw  []byte
		want AlbumPage
	}{
		{"the header's title, kind, year and artist, and its songs with the album's art, not their play counts", live, AlbumPage{
			Album: Album{Title: "Abbey Road (2019 Mix)", Artist: "The Beatles", ArtistID: beatles, Year: "1969", Kind: "Album", Thumb: art},
			Tracks: []Track{
				song("45cYwDMibGo", "Come Together (2019 Mix)", 261),
				song("UelDrZ1aFeY", "Something (2019 Mix)", 183),
				song("J-DRvbY9KhQ", "Maxwell's Silver Hammer (2019 Mix)", 208),
			},
		}},
		{"a page that isn't an album has no title", []byte(`{"contents":{}}`), AlbumPage{}},
	}
	for _, c := range cases {
		got, err := parseAlbum(c.raw)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %+v, %v\nwant %+v", c.name, got, err, c.want)
		}
	}
}

func TestAlbumSubtitle(t *testing.T) {
	cases := []struct {
		runs               []string
		kind, artist, year string
	}{
		{[]string{"Album", " • ", "The Beatles", " • ", "1969"}, "Album", "The Beatles", "1969"},
		{[]string{"EP", " • ", "Yovie Widianto", " & ", "Tulus", " • ", "2019"}, "EP", "Yovie Widianto & Tulus", "2019"},
		{[]string{"Single", " • ", "2026"}, "Single", "", "2026"},
		{[]string{"2022"}, "", "", "2022"},
		{nil, "", "", ""},
	}
	for _, c := range cases {
		kind, artist, year := albumSubtitle(c.runs)
		if kind != c.kind || artist != c.artist || year != c.year {
			t.Errorf("albumSubtitle(%q) = %q %q %q, want %q %q %q", c.runs, kind, artist, year, c.kind, c.artist, c.year)
		}
	}
}

// next_track.json is a live anonymous next call for Queen's "Bohemian
// Rhapsody" (Nov 2026), trimmed to the one row it answers with.
func TestParseTrack(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "next_track.json"))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, videoID string
		want          Track
	}{
		{"the video asked for, with its artist and album links", "BSTsnWoslP4", Track{VideoID: "BSTsnWoslP4", Title: "Bohemian Rhapsody",
			Artist: "Queen", ArtistID: "UCEPMVbUzImPl4p8k4LkGevA", Album: "A Night At The Opera", Duration: 355,
			Thumb: "https://yt3.googleusercontent.com/nLn1gxvYiZqzXOY9HyUXVXbFtmR5nhY8sDpbvBT1aw-Ejjsz__Nz90sZoc4nZgff2sf8WjowuVRVBlBTww=w544-h544-l90-rj"}},
		{"an answer about another video is no answer", "aaaaaaaaaaa", Track{}},
	}
	for _, c := range cases {
		got, err := parseTrack(live, c.videoID)
		if err != nil || got != c.want {
			t.Errorf("%s:\n got %+v, %v\nwant %+v", c.name, got, err, c.want)
		}
	}
}

// next_radio.json is a live anonymous next call for the song radio of IU's
// "Dear my crazy soulmate" (Nov 2026), trimmed to four rows plus the seed
// repeated at the end.
func TestParseRadioDropsTheSeedAndRepeats(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "next_radio.json"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := parseRadio(live, "IHIt9S2DWcQ")
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ videoID, title, artist, album string }{
		{"es6bbfAjk3I", "Celebrity", "IU", "IU 5th Album 'LILAC'"},
		{"bB8rDZPNjyI", "삐그덕 (seesaw) (feat. 아이유(IU))", "Crush", "삐그덕 (seesaw)"},
		{"R5By6ms2a3Y", "Suddenly", "I.O.I", "I.O.I 3rd MINI ALBUM [I.O.I : LOOP]"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d tracks, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		g := got[i]
		if g.VideoID != w.videoID || g.Title != w.title || g.Artist != w.artist || g.Album != w.album || g.Duration == 0 || g.Thumb == "" {
			t.Errorf("track %d: got %+v, want %+v with a duration and thumb", i, g, w)
		}
	}
}

// browse_artist_songs.json is a live anonymous browse of the playlist behind
// Tulus's "Top songs" (Nov 2026), trimmed to six of its 71 rows. Its rows
// have a play count where a playlist's have the album.
func TestParsePlaylistReadsAnArtistsSongs(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "browse_artist_songs.json"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := parsePlaylist(live)
	if err != nil || len(got.Tracks) != 6 {
		t.Fatalf("got %d songs, %v; want 6", len(got.Tracks), err)
	}
	cases := []struct {
		name string
		got  Track
		want Track
	}{
		{"a song links its artist and keeps the album, not the play count", got.Tracks[0],
			Track{VideoID: "5F28ye50-Kc", Title: "Teh Hijau", Artist: "Tulus", ArtistID: "UC_DHlXllTSMB8pTC38_leFg", Album: "Teh Hijau", Duration: 213}},
		{"a song by several artists links the first", got.Tracks[5],
			Track{VideoID: "aZLzcvHffVc", Title: "Adu Rayu", Artist: "Yovie Widianto, Tulus & Glenn Fredly", ArtistID: "UCWpMHJPVmQ9dXa-EWJEC33Q", Album: "Adu Rayu", Duration: 208}},
	}
	for _, c := range cases {
		c.got.Thumb = "" // pinned by the playlist test
		if c.got != c.want {
			t.Errorf("%s:\n got %+v\nwant %+v", c.name, c.got, c.want)
		}
	}
}

// search_suggestions.json is a live anonymous suggestions call for "tul"
// (Nov 2026), trimmed to three suggestions. The artist and song rows YouTube
// sends along are not suggestions.
func TestParseSuggestions(t *testing.T) {
	live, err := os.ReadFile(filepath.Join("testdata", "search_suggestions.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"tulus", "tulus teh hijau", "tulus full album"}
	got, err := parseSuggestions(live)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, %v\nwant %v", got, err, want)
	}
}

func TestParseQueueLinksTheArtist(t *testing.T) {
	raw := `{"items":[{"playlistPanelVideoRenderer":{"videoId":"v1","title":{"runs":[{"text":"Monokrom"}]},"longBylineText":{"runs":[
	 {"text":"Tulus","navigationEndpoint":{"browseEndpoint":{"browseId":"UC_DHlXllTSMB8pTC38_leFg","browseEndpointContextSupportedConfigs":{"browseEndpointContextMusicConfig":{"pageType":"MUSIC_PAGE_TYPE_ARTIST"}}}}},
	 {"text":" • "},
	 {"text":"Monokrom","navigationEndpoint":{"browseEndpoint":{"browseId":"MPREb_4TEBtGA3cZb","browseEndpointContextSupportedConfigs":{"browseEndpointContextMusicConfig":{"pageType":"MUSIC_PAGE_TYPE_ALBUM"}}}}}]}}}]}`
	got, _, err := parseQueue(json.RawMessage(raw))
	if err != nil || len(got) != 1 || got[0].ArtistID != "UC_DHlXllTSMB8pTC38_leFg" {
		t.Errorf("got %+v, %v; want the artist's channel, not the album's", got, err)
	}
}
