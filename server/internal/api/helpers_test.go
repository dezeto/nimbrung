package api

import "testing"

func TestVideoIDFromURL(t *testing.T) {
	cases := map[string]string{
		"https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc": "dQw4w9WgXcQ",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":          "dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ?t=10":                    "dQw4w9WgXcQ",
		"youtube.com/shorts/dQw4w9WgXcQ":                       "dQw4w9WgXcQ",
		"https://example.com/watch?v=dQw4w9WgXcQ":              "",
		"https://music.youtube.com/playlist?list=PL123":        "",
		"not a url": "",
		"":          "",
	}
	for in, want := range cases {
		if got := VideoIDFromURL(in); got != want {
			t.Errorf("VideoIDFromURL(%q) = %q, want %q", in, got, want)
		}
	}
}
