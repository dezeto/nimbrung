package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// The setup window relies on this: a working cached token is reused without
// asking, and a missing or stale one is asked for once and cached.
func TestConnectPlayer(t *testing.T) {
	tests := []struct {
		name      string
		cached    string // "" = no token file
		wantAsks  int
		wantSaved string
	}{
		{"cached token works", "good", 0, "good"},
		{"no token asks once", "", 1, "fresh"},
		{"stale token asks again", "old", 1, "fresh"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			asks := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == http.MethodPost && r.URL.Path == "/auth/nimbrung":
					asks++
					_, _ = io.WriteString(w, `{"accessToken":"fresh"}`)
				case r.URL.Path == "/api/v1/song":
					auth := r.Header.Get("Authorization")
					if auth != "Bearer good" && auth != "Bearer fresh" {
						w.WriteHeader(http.StatusUnauthorized)
						return
					}
					w.WriteHeader(http.StatusNoContent)
				default:
					http.NotFound(w, r)
				}
			}))
			defer srv.Close()

			tokenFile := filepath.Join(t.TempDir(), "token")
			if tc.cached != "" {
				if err := os.WriteFile(tokenFile, []byte(tc.cached), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			log := slog.New(slog.NewTextHandler(io.Discard, nil))

			if _, err := connectPlayer(context.Background(), srv.URL, "nimbrung", tokenFile, log); err != nil {
				t.Fatalf("connectPlayer: %v", err)
			}
			saved, _ := os.ReadFile(tokenFile)
			if asks != tc.wantAsks || string(saved) != tc.wantSaved {
				t.Errorf("asked %d times, saved %q; want %d, %q", asks, saved, tc.wantAsks, tc.wantSaved)
			}
		})
	}
}
