package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // the art hosts serve JPEG to clients that don't ask for WebP
	_ "image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// artHosts are the only hosts handleArtAccent fetches from, so the endpoint
// can't be used to make the laptop request arbitrary URLs.
var artHosts = []string{"googleusercontent.com", "ytimg.com", "ggpht.com"}

var artSize = regexp.MustCompile(`=w\d+-h\d+`)

// Artwork is small: the googleusercontent links are asked for 32×32, and
// YouTube's biggest thumbnail is 1280×720. Anything past these is not
// artwork, and a tiny file can claim a size that takes gigabytes to decode.
const (
	maxArtBytes = 1 << 20
	maxArtSide  = 2048
)

// artURL checks raw is https on an art host and asks for a small copy.
func artURL(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || !onArtHost(u) {
		return "", false
	}
	return artSize.ReplaceAllString(u.String(), "=w32-h32"), true
}

func onArtHost(u *url.URL) bool {
	if u.Scheme != "https" {
		return false
	}
	host := u.Hostname()
	for _, h := range artHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return true
		}
	}
	return false
}

var errOffArtHosts = errors.New("redirected off the art hosts")

// newArtClient follows a redirect only to another art host, so a redirect
// can't send the laptop anywhere artURL wouldn't.
func newArtClient() *http.Client {
	return &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 || !onArtHost(req.URL) {
				return errOffArtHosts
			}
			return nil
		},
	}
}

// handleArtAccent returns the main colour of a song's artwork, for the
// page's progress bar. The art hosts answer browsers' CORS reads with 429,
// so the laptop reads the picture instead. 204 when the art is grey.
func (s *Server) handleArtAccent(w http.ResponseWriter, r *http.Request) {
	src, ok := artURL(r.URL.Query().Get("src"))
	if !ok {
		writeErr(w, http.StatusBadRequest, "not an artwork link")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "not an artwork link")
		return
	}
	resp, err := s.art.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "couldn't fetch the artwork")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeErr(w, http.StatusBadGateway, "couldn't fetch the artwork")
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxArtBytes+1))
	if err != nil || len(body) > maxArtBytes {
		writeErr(w, http.StatusBadGateway, "couldn't read the artwork")
		return
	}
	// The header first: decoding allocates for whatever size it claims.
	size, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || size.Width > maxArtSide || size.Height > maxArtSide {
		writeErr(w, http.StatusBadGateway, "couldn't read the artwork")
		return
	}
	img, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		writeErr(w, http.StatusBadGateway, "couldn't read the artwork")
		return
	}
	// The same song's colour never changes: let the browser keep it.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	color, ok := accent(img)
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"color": color})
}

// accent picks the most colourful pixel that isn't near black or white and
// sets its lightness to read on the dark glass. False for grey artwork.
func accent(img image.Image) (string, bool) {
	var bestH, bestS, bestScore float64
	found := false
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			h, s, l := toHSL(float64(r)/0xffff, float64(g)/0xffff, float64(bl)/0xffff)
			if l < 0.15 || l > 0.9 {
				continue
			}
			if score := s * (1 - math.Abs(l-0.5)); !found || score > bestScore {
				bestH, bestS, bestScore, found = h, s, score, true
			}
		}
	}
	if !found || bestS < 0.25 {
		return "", false
	}
	return fmt.Sprintf("hsl(%d %d%% 62%%)", int(math.Round(bestH)), int(math.Round(math.Max(bestS, 0.55)*100))), true
}

func toHSL(r, g, b float64) (h, s, l float64) {
	maxC, minC := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
	l = (maxC + minC) / 2
	d := maxC - minC
	if d == 0 {
		return 0, 0, l
	}
	s = d / (1 - math.Abs(2*l-1))
	switch maxC {
	case r:
		h = math.Mod((g-b)/d+6, 6)
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	return h * 60, s, l
}
