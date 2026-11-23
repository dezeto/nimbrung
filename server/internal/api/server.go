// Package api exposes the room over HTTP for the web UI.
//
// Transport choices, deliberately boring:
//   - JSON over plain fetch for commands (join, add, remove, skip…)
//   - Server-Sent Events (GET /api/events) to push the room snapshot; the UI
//     never polls. SSE is one-way, which is all we need, and works through
//     Cloudflare/Tailscale tunnels without extra config.
//   - A cookie carries the guest ID. No accounts, no JWTs.
package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/dezeto/nimbrung/internal/lyrics"
	"github.com/dezeto/nimbrung/internal/room"
	"github.com/dezeto/nimbrung/internal/ytm"
)

const guestCookie = "nimbrung_guest"

// stateEvent is the SSE event name for room snapshots; the web UI's
// ServerEvent.State must match it.
const stateEvent = "state"

// SSE event names for moments pushed as they happen; the web UI's
// ServerEvent.Reaction and ServerEvent.Feed must match them.
const (
	reactionEvent = "reaction"
	feedEvent     = "feed"
)

// eventNames maps room events to wire names here, next to stateEvent,
// because the room knows nothing about SSE.
var eventNames = map[room.EventKind]string{
	room.EventReaction: reactionEvent,
	room.EventFeed:     feedEvent,
}

// Server wires HTTP routes to a Room.
type Server struct {
	room    *room.Room
	hostKey string        // shared secret the host's browser presents to become host
	joinURL func() string // LAN join link; the host page opened on localhost can't work it out itself
	log     *slog.Logger
	mux     *http.ServeMux
	art     *http.Client // fetches artwork for /api/art-accent; see newArtClient

	// Lyrics finds lyrics for /api/lyrics; nil turns lyrics off.
	Lyrics *lyrics.Client
}

// New builds the handler. static is the built web UI (may be nil in dev,
// when Vite serves the UI and proxies /api to us).
func New(r *room.Room, hostKey string, joinURL func() string, static fs.FS, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	s := &Server{room: r, hostKey: hostKey, joinURL: joinURL, log: log, mux: http.NewServeMux(), art: newArtClient()}
	s.routes(static)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func (s *Server) routes(static fs.FS) {
	m := s.mux
	m.HandleFunc("GET /api/room", s.handleRoom)
	m.HandleFunc("GET /api/art-accent", s.handleArtAccent)
	// No guest needed: the room view shows lyrics too, and only songs in the
	// jam are looked up, so it's no open door to LRCLIB.
	m.HandleFunc("GET /api/lyrics/{videoId}", s.handleLyrics)
	m.HandleFunc("GET /api/recap", s.handleRecap)
	m.HandleFunc("POST /api/join", s.handleJoin)
	m.HandleFunc("POST /api/leave", s.withGuest(s.handleLeave))
	m.HandleFunc("GET /api/me", s.withGuestOrWaiting(s.handleMe))
	m.HandleFunc("GET /api/events", s.handleEvents)
	m.HandleFunc("GET /api/search", s.withGuest(s.handleSearch))
	m.HandleFunc("GET /api/playlists/{playlistId}", s.withGuest(s.handlePlaylist))
	m.HandleFunc("POST /api/queue", s.withGuest(s.handleAdd))
	m.HandleFunc("DELETE /api/queue/{videoId}", s.withGuest(s.handleRemove))
	m.HandleFunc("PATCH /api/queue/{videoId}", s.withGuest(s.handleMove))
	m.HandleFunc("POST /api/skip", s.withGuest(s.handleSkip))
	m.HandleFunc("POST /api/reactions", s.withGuest(s.handleReact))
	m.HandleFunc("POST /api/comments", s.withGuest(s.handleComment))
	m.HandleFunc("POST /api/host/play", s.withGuest(s.handlePlay))
	m.HandleFunc("POST /api/host/pause", s.withGuest(s.handlePause))
	m.HandleFunc("POST /api/shuffle", s.withGuest(s.handleShuffle))
	m.HandleFunc("PUT /api/host/rules", s.withGuest(s.handleRules))
	m.HandleFunc("PUT /api/host/volume", s.withGuest(s.handleVolume))
	m.HandleFunc("PUT /api/host/mute", s.withGuest(s.handleMute))
	m.HandleFunc("POST /api/nudges", s.withGuest(s.handleNudge))
	m.HandleFunc("DELETE /api/nudges", s.withGuest(s.handleWithdrawNudge))
	m.HandleFunc("POST /api/host/guests", s.withGuest(s.handleLetIn))
	m.HandleFunc("DELETE /api/host/guests/{guestId}", s.withGuest(s.handleKick))
	m.HandleFunc("POST /api/host/blocked", s.withGuest(s.handleBlock))
	m.HandleFunc("DELETE /api/host/blocked/{blockedId}", s.withGuest(s.handleUnblock))
	if static != nil {
		m.Handle("/", spaHandler(static))
	}
}

// --- middleware ---------------------------------------------------------

type guestKey struct{}

// withGuest requires a valid guest cookie and puts the guest in the context.
// Someone still waiting for the host to let them in gets ErrWaiting.
func (s *Server) withGuest(next http.HandlerFunc) http.HandlerFunc {
	return s.withSession(next, false)
}

// withGuestOrWaiting is withGuest that lets the waiting through too, for
// /api/me, which the waiting screen asks until they're let in.
func (s *Server) withGuestOrWaiting(next http.HandlerFunc) http.HandlerFunc {
	return s.withSession(next, true)
}

func (s *Server) withSession(next http.HandlerFunc, waitingToo bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(guestCookie)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "join the room first")
			return
		}
		g, ok := s.room.GuestBySession(c.Value)
		if !ok {
			// Kept, not cleared: every tab holding this cookie keeps hearing
			// they were removed, until they join again.
			if s.room.Kicked(c.Value) {
				s.writeRoomErr(w, room.ErrKicked)
				return
			}
			clearCookie(w)
			writeErr(w, http.StatusUnauthorized, "join the room first")
			return
		}
		if g.Waiting && !waitingToo {
			s.writeRoomErr(w, room.ErrWaiting)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), guestKey{}, g)))
	}
}

func guestFrom(r *http.Request) *room.Guest {
	g, _ := r.Context().Value(guestKey{}).(*room.Guest)
	return g
}

// --- handlers -----------------------------------------------------------

// handleRoom answers anyone, but gives the code and join link only to
// whoever may know them (see knowsTheCode); everyone else gets "" for both.
func (s *Server) handleRoom(w http.ResponseWriter, r *http.Request) {
	st := s.room.State()
	code, joinURL := "", ""
	if s.knowsTheCode(r) {
		code, joinURL = s.room.Code(), s.joinURL()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    code,
		"name":    st.Name,
		"guests":  len(st.Guests),
		"rules":   st.Rules,
		"player":  st.Player,
		"joinUrl": joinURL,
		"avatars": map[string]any{"all": room.Avatars, "taken": s.room.AvatarsTaken()},
	})
}

// knowsTheCode reports whether r may be told the join code. A guest, or
// someone waiting to be let in, typed it to join. The host's own computer
// shows it on the host page and the room view. Anyone else only found the
// address, and finding the public link must not be enough to join.
func (s *Server) knowsTheCode(r *http.Request) bool {
	if clientIP(r) == "" {
		return true
	}
	c, err := r.Cookie(guestCookie)
	if err != nil {
		return false
	}
	_, ok := s.room.GuestBySession(c.Value)
	return ok
}

// handleRecap is public like the room's stream: the TV shows it too.
func (s *Server) handleRecap(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.room.Recap())
}

func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code    string `json:"code"`
		Name    string `json:"name"`
		Avatar  string `json:"avatar"`
		HostKey string `json:"hostKey,omitempty"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	isHost := s.hostKey != "" && subtle.ConstantTimeCompare([]byte(in.HostKey), []byte(s.hostKey)) == 1
	// A stale key (the server makes a new one each run) must fail loudly,
	// not quietly turn the host into a regular guest.
	if in.HostKey != "" && !isHost {
		writeErr(w, http.StatusForbidden, "wrong host key — use the Host link from the terminal")
		return
	}
	// The host key is enough: the host page opened anywhere but the host's
	// computer isn't told the code until it has joined.
	if !isHost {
		if err := s.room.CheckCode(in.Code, clientIP(r)); err != nil {
			s.writeRoomErr(w, err)
			return
		}
	}
	g, err := s.room.Join(in.Name, in.Avatar, clientIP(r), isHost)
	if err != nil {
		s.writeRoomErr(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     guestCookie,
		Value:    g.Session,
		Path:     "/",
		HttpOnly: true,
		// Through the tunnel the page is https, and the tunnel says so; on the
		// Wi-Fi it's plain http, where a Secure cookie would never come back.
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((12 * time.Hour).Seconds()),
	})
	writeJSON(w, http.StatusOK, g)
}

// clientIP is where a request comes from, for blocking. A tunnel (ngrok)
// connects from this machine and names the caller last in X-Forwarded-For.
// Only a loopback peer is believed, or anyone on the Wi-Fi could claim any
// address. The host's own computer comes out "": blocking it would block
// everyone the tunnel brings in.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	peer := net.ParseIP(host)
	if err != nil || peer == nil {
		return ""
	}
	if !peer.IsLoopback() {
		return peer.String()
	}
	fwd := r.Header.Values("X-Forwarded-For")
	if len(fwd) == 0 {
		return ""
	}
	last := fwd[len(fwd)-1]
	if ip := net.ParseIP(strings.TrimSpace(last[strings.LastIndex(last, ",")+1:])); ip != nil && !ip.IsLoopback() {
		return ip.String()
	}
	return ""
}

func (s *Server) handleLeave(w http.ResponseWriter, r *http.Request) {
	s.room.Leave(guestFrom(r).ID)
	clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	g := guestFrom(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"guest":         g,
		"addsRemaining": s.room.AddsRemaining(g.ID),
		"waiting":       g.Waiting,
	})
}

// handleEvents streams room snapshots as SSE "state" events, and reactions
// and feed entries as their own events the moment they happen.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, cancel := s.room.Subscribe()
	defer cancel()
	events, stopListening := s.room.Listen()
	defer stopListening()

	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepalive.C:
			_, _ = w.Write([]byte(": ping\n\n"))
			flusher.Flush()
		case st := <-ch:
			writeEvent(w, stateEvent, st)
			flusher.Flush()
		case ev := <-events:
			writeEvent(w, eventNames[ev.Kind], ev.Data)
			flusher.Flush()
		}
	}
}

// writeEvent writes one SSE event; a value that won't marshal is skipped.
func writeEvent(w http.ResponseWriter, name string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	_, _ = w.Write([]byte("event: " + name + "\ndata: "))
	_, _ = w.Write(b)
	_, _ = w.Write([]byte("\n\n"))
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, err := s.room.Search(r.Context(), ytm.SearchRequest{
		Query:  q.Get("q"),
		Kind:   ytm.SearchKind(q.Get("type")),
		Cursor: q.Get("cursor"),
	})
	if err != nil {
		s.writeRoomErr(w, err)
		return
	}
	if page.Tracks == nil {
		page.Tracks = []ytm.Track{}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handlePlaylist(w http.ResponseWriter, r *http.Request) {
	page, err := s.room.Playlist(r.Context(), r.PathValue("playlistId"))
	if err != nil {
		s.writeRoomErr(w, err)
		return
	}
	if page.Tracks == nil {
		page.Tracks = []ytm.Track{}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleAdd(w http.ResponseWriter, r *http.Request) {
	var in struct {
		VideoID string `json:"videoId"`
		URL     string `json:"url,omitempty"` // alternative: a pasted/shared YT link
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	id := in.VideoID
	if id == "" && in.URL != "" {
		id = VideoIDFromURL(in.URL)
	}
	if id == "" && in.URL != "" {
		writeErr(w, http.StatusBadRequest, "that link isn't a YouTube song")
		return
	}
	if id == "" {
		writeErr(w, http.StatusBadRequest, "videoId or url required")
		return
	}
	g := guestFrom(r)
	if err := s.room.Add(r.Context(), g.ID, id); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "addsRemaining": s.room.AddsRemaining(g.ID)})
}

func (s *Server) handleRemove(w http.ResponseWriter, r *http.Request) {
	if err := s.room.Remove(r.Context(), guestFrom(r).ID, r.PathValue("videoId")); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSkip(w http.ResponseWriter, r *http.Request) {
	votes, skipped, err := s.room.VoteSkip(r.Context(), guestFrom(r).ID)
	if err != nil {
		s.writeRoomErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"votes": votes, "skipped": skipped})
}

func (s *Server) handleReact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Reaction room.Reaction `json:"reaction"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.React(guestFrom(r).ID, in.Reaction); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleComment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text string `json:"text"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.Comment(guestFrom(r).ID, in.Text); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePlay(w http.ResponseWriter, r *http.Request) {
	if err := s.room.Play(r.Context(), guestFrom(r).ID); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePause(w http.ResponseWriter, r *http.Request) {
	if err := s.room.Pause(r.Context(), guestFrom(r).ID); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLyrics(w http.ResponseWriter, r *http.Request) {
	track, ok := s.room.Track(r.PathValue("videoId"))
	if !ok || s.Lyrics == nil {
		writeErr(w, http.StatusNotFound, "no lyrics")
		return
	}
	l, err := s.Lyrics.Find(r.Context(), track)
	if err != nil {
		s.log.Warn("lyrics lookup failed", "videoId", track.VideoID, "err", err)
		writeErr(w, http.StatusBadGateway, "couldn't reach the lyrics service")
		return
	}
	if l == nil {
		writeErr(w, http.StatusNotFound, "no lyrics")
		return
	}
	writeJSON(w, http.StatusOK, l)
}

func (s *Server) handleShuffle(w http.ResponseWriter, r *http.Request) {
	if err := s.room.Shuffle(r.Context(), guestFrom(r).ID); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMove(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Position int `json:"position"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.Move(r.Context(), guestFrom(r).ID, r.PathValue("videoId"), in.Position); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRules(w http.ResponseWriter, r *http.Request) {
	var rules room.Rules
	if err := readJSON(r, &rules); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.SetRules(guestFrom(r).ID, rules); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleVolume(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Level int `json:"level"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.SetVolume(r.Context(), guestFrom(r).ID, in.Level); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMute(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Muted bool `json:"muted"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.SetMuted(r.Context(), guestFrom(r).ID, in.Muted); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleNudge(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Nudge room.Nudge `json:"nudge"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.NudgeVolume(guestFrom(r).ID, in.Nudge); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWithdrawNudge(w http.ResponseWriter, r *http.Request) {
	s.room.WithdrawNudge(guestFrom(r).ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleKick(w http.ResponseWriter, r *http.Request) {
	if err := s.room.Kick(guestFrom(r).ID, r.PathValue("guestId")); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLetIn(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GuestID string `json:"guestId"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.LetIn(guestFrom(r).ID, in.GuestID); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GuestID string `json:"guestId"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request")
		return
	}
	if err := s.room.Block(guestFrom(r).ID, in.GuestID); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnblock(w http.ResponseWriter, r *http.Request) {
	if err := s.room.Unblock(guestFrom(r).ID, r.PathValue("blockedId")); err != nil {
		s.writeRoomErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- error mapping ------------------------------------------------------

func (s *Server) writeRoomErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, room.ErrNotFound), errors.Is(err, room.ErrWrongCode):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, room.ErrNotOwner), errors.Is(err, room.ErrNotHost), errors.Is(err, room.ErrBlocked),
		errors.Is(err, room.ErrWaiting):
		writeErr(w, http.StatusForbidden, err.Error())
	case errors.Is(err, room.ErrDuplicate), errors.Is(err, room.ErrNameTaken), errors.Is(err, room.ErrAvatarTaken):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, room.ErrBadReaction), errors.Is(err, room.ErrBadComment), errors.Is(err, room.ErrKickSelf),
		errors.Is(err, room.ErrBadNudge), errors.Is(err, room.ErrCantBlock):
		writeErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, room.ErrRateLimited), errors.Is(err, room.ErrTooFast), errors.Is(err, room.ErrManyJoins),
		errors.Is(err, room.ErrManyGuesses):
		writeErr(w, http.StatusTooManyRequests, err.Error())
	case errors.Is(err, room.ErrUnknownUser):
		writeErr(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, room.ErrKicked):
		// Browsers keep a 410 fresh forever unless told otherwise, and would
		// answer "removed" from their cache after the guest joins again.
		w.Header().Set("Cache-Control", "no-store")
		writeErr(w, http.StatusGone, err.Error())
	case errors.Is(err, ytm.ErrUnauthorized), errors.Is(err, ytm.ErrNotQueued):
		writeErr(w, http.StatusBadGateway, err.Error())
	default:
		s.log.Error("request failed", "err", err)
		writeErr(w, http.StatusBadGateway, "YouTube Music isn't responding — is the app running?")
	}
}
