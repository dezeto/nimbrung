// Command nimbrung runs the jam server: it connects to the YouTube Music
// desktop app's API Server plugin on the host machine and serves the guest
// web UI.
//
// Usage (defaults shown):
//
//	nimbrung -listen :8080 -ytm http://127.0.0.1:26538 -name "my living room"
//
// On first run it asks the plugin for a token; the YouTube Music app shows an
// Allow/Deny dialog. The token is cached in -token-file so later runs are
// silent; -authorize does only that and exits (the menu-bar setup window
// runs it). The host opens http://localhost:8080/host?key=<host key printed at
// startup> to get host powers (remove anything, skip, pause).
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/dezeto/nimbrung/internal/api"
	"github.com/dezeto/nimbrung/internal/lyrics"
	"github.com/dezeto/nimbrung/internal/room"
	"github.com/dezeto/nimbrung/internal/web"
	"github.com/dezeto/nimbrung/internal/ytm"
)

func main() {
	var (
		listen    = flag.String("listen", ":8080", "address for the guest UI/API")
		ytmBase   = flag.String("ytm", "http://127.0.0.1:26538", "base URL of the YouTube Music API Server plugin")
		name      = flag.String("name", "the jam", "room name shown to guests")
		code      = flag.String("code", "", "join code (default: random 4 chars)")
		tokenFile = flag.String("token-file", configFile("token"), "where to cache the plugin access token")
		lyricsURL = flag.String("lyrics", "https://lrclib.net", "LRCLIB to ask for lyrics (\"\" = no lyrics)")
		stateFile = flag.String("state-file", configFile("jam.json"), "where guests and who added what are saved, so a restart keeps them (\"\" = don't save)")
		clientID  = flag.String("client-id", "nimbrung", "client ID shown in the plugin's approval dialog")
		maxAdds   = flag.Int("max-adds", room.DefaultRules.MaxAddsPerMinute, "max adds per guest per minute (0 = unlimited)")
		skipVotes = flag.Int("skip-votes", room.DefaultRules.SkipVotesNeeded, "votes needed to skip a song")
		askToJoin = flag.Bool("ask-to-join", false, "new guests wait until the host lets them in")
		poll      = flag.Duration("poll", time.Second, "how often to sync with the player")
		hostKey   = flag.String("host-key", "", "secret that grants host powers (default: random)")
		publicURL = flag.String("public-url", "", "address guests join on from anywhere, like https://jam.example.com (default: this laptop's Wi-Fi address)")
		authorize = flag.Bool("authorize", false, "only get player access (the host clicks Allow in YouTube Music), cache it in -token-file and exit")
	)
	flag.Parse()
	// flag stops at the first word without a dash, so `-code K7QX extra`
	// would quietly drop extra (and any flags after it). Refuse instead,
	// the way flag itself refuses an unknown flag.
	if flag.NArg() > 0 {
		fmt.Fprintf(os.Stderr, "unexpected %q: every value needs its flag in front, like -host-key secret\n\n", flag.Arg(0))
		flag.Usage()
		os.Exit(2)
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if *authorize {
		// The setup window runs this and shows our last line, so plain words.
		// The host may take a while to find the Allow dialog.
		slow := ytm.WithHTTPClient(&http.Client{Timeout: 2 * time.Minute})
		if _, err := connectPlayer(ctx, *ytmBase, *clientID, *tokenFile, log, slow); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("Nimbrung can control the player.")
		return
	}

	player, err := connectPlayer(ctx, *ytmBase, *clientID, *tokenFile, log)
	if err != nil {
		log.Error("cannot reach YouTube Music", "err", err)
		os.Exit(1)
	}

	if *code == "" {
		*code = room.NewCode()
	}
	if *hostKey == "" {
		*hostKey = randomHex(8)
	}
	rules := room.Rules{MaxAddsPerMinute: *maxAdds, SkipVotesNeeded: *skipVotes, AskToJoin: *askToJoin}
	rm := room.New(strings.ToUpper(*code), *name, player, rules, log)
	if *stateFile != "" {
		if err := rm.Persist(*stateFile); err != nil {
			log.Warn("couldn't load the saved jam; starting fresh", "err", err)
		}
	}
	go rm.Run(ctx, *poll)

	static, err := web.Dist()
	if err != nil {
		log.Warn("web UI not embedded; serving API only (run `make web` first)", "err", err)
		static = nil
	}
	// Asked again on every request: the laptop can change Wi-Fi mid-jam.
	joinURL := func() string {
		if *publicURL != "" {
			return strings.TrimRight(*publicURL, "/") + "/join/" + rm.Code()
		}
		return guestURL(*listen, rm.Code())
	}
	handler := api.New(rm, *hostKey, joinURL, static, log)
	if *lyricsURL != "" {
		handler.Lyrics = lyrics.New(*lyricsURL)
	}
	srv := &http.Server{
		Addr:              *listen,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	printBanner(*listen, joinURL(), rm.Code(), *hostKey)

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

// connectPlayer builds the plugin client, reusing a cached token or asking
// the host to approve a new one.
func connectPlayer(ctx context.Context, base, clientID, tokenFile string, log *slog.Logger, extra ...ytm.Option) (*ytm.Client, error) {
	opts := append([]ytm.Option{ytm.WithLogger(log)}, extra...)
	if b, err := os.ReadFile(tokenFile); err == nil && len(b) > 0 {
		opts = append(opts, ytm.WithToken(strings.TrimSpace(string(b))))
	}
	c := ytm.New(base, opts...)

	// Probe. On 401/403 we (re)authorise.
	_, err := c.NowPlaying(ctx)
	if errors.Is(err, ytm.ErrUnauthorized) || c.Token() == "" {
		log.Info("requesting access — click Allow in the YouTube Music app")
		tok, aerr := c.Authorize(ctx, clientID)
		if aerr != nil {
			return nil, aerr
		}
		if werr := os.WriteFile(tokenFile, []byte(tok), 0o600); werr != nil {
			log.Warn("could not cache token", "err", werr)
		}
		_, err = c.NowPlaying(ctx)
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// guestURL is the join link phones can open: the LAN address rather than localhost.
func guestURL(listen, code string) string {
	host, port, _ := net.SplitHostPort(listen)
	if host == "" || host == "0.0.0.0" {
		host = lanIP()
	}
	return fmt.Sprintf("http://%s:%s/join/%s", host, port, code)
}

func printBanner(listen, joinURL, code, hostKey string) {
	_, port, _ := net.SplitHostPort(listen)
	fmt.Printf("\nNimbrung is up.\n")
	fmt.Printf("  Guests:  %s\n", joinURL)
	fmt.Printf("  Host:    http://localhost:%s/host?key=%s\n", port, hostKey)
	fmt.Printf("  Code:    %s\n\n", code)
}

func lanIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "localhost"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

// configFile is name in the user's nimbrung config folder, made if missing.
func configFile(name string) string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ".nimbrung-" + name
	}
	_ = os.MkdirAll(filepath.Join(dir, "nimbrung"), 0o700)
	return filepath.Join(dir, "nimbrung", name)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
