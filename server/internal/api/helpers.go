package api

import (
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
)

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: guestCookie, Value: "", Path: "/", MaxAge: -1})
}

// VideoIDFromURL extracts the video ID from the YouTube / YouTube Music URL
// shapes guests paste or share: watch?v=, youtu.be/, /shorts/, /embed/.
// Returns "" when no ID is found.
func VideoIDFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	switch host {
	case "youtu.be":
		return cleanID(strings.Trim(u.Path, "/"))
	case "youtube.com", "music.youtube.com", "m.youtube.com":
		if v := u.Query().Get("v"); v != "" {
			return cleanID(v)
		}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) == 2 && (parts[0] == "shorts" || parts[0] == "embed" || parts[0] == "live") {
			return cleanID(parts[1])
		}
	}
	return ""
}

func cleanID(s string) string {
	if len(s) != 11 {
		return ""
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return ""
		}
	}
	return s
}

// spaHandler serves the built UI and falls back to index.html for client
// routes so TanStack Router deep links work on refresh.
func spaHandler(static fs.FS) http.Handler {
	fileServer := http.FileServerFS(static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if f, err := static.Open(p); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
