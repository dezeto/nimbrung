package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"image"
	"image/color"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fill(colors ...color.RGBA) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, len(colors), 1))
	for i, c := range colors {
		img.Set(i, 0, c)
	}
	return img
}

func TestAccentPicksTheArtworksColour(t *testing.T) {
	if _, ok := accent(fill(color.RGBA{128, 128, 128, 255}, color.RGBA{20, 20, 20, 255}, color.RGBA{250, 250, 250, 255})); ok {
		t.Fatal("grey artwork should have no accent")
	}
	pink, ok := accent(fill(color.RGBA{10, 10, 10, 255}, color.RGBA{230, 40, 160, 255}, color.RGBA{240, 240, 240, 255}))
	if !ok || !strings.HasPrefix(pink, "hsl(32") || !strings.HasSuffix(pink, " 62%)") {
		t.Fatalf("pink artwork accent = %q, want a pink hue at 62%% lightness", pink)
	}
}

func TestArtURLOnlyAllowsArtHosts(t *testing.T) {
	for raw, want := range map[string]string{
		"https://yt3.googleusercontent.com/abc=w544-h544-l90-rj": "https://yt3.googleusercontent.com/abc=w32-h32-l90-rj",
		"https://i.ytimg.com/vi/x/hqdefault.jpg":                 "https://i.ytimg.com/vi/x/hqdefault.jpg",
		"http://i.ytimg.com/vi/x/hqdefault.jpg":                  "",
		"https://evil.example/googleusercontent.com/x":           "",
		"https://notgoogleusercontent.com/x":                     "",
		"http://127.0.0.1:26538/api":                             "",
	} {
		got, ok := artURL(raw)
		if ok != (want != "") || got != want {
			t.Errorf("artURL(%q) = %q, %v; want %q", raw, got, ok, want)
		}
	}
}

// pngOf encodes img, for an art host to serve.
func pngOf(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestArtAccentReadsOnlySmallArtworkFromArtHosts(t *testing.T) {
	pink := pngOf(t, fill(color.RGBA{230, 40, 160, 255}))
	// Grey compresses to almost nothing, so a few kilobytes claim 9 megapixels.
	huge := pngOf(t, image.NewGray(image.Rect(0, 0, maxArtSide+1, maxArtSide+1)))
	cases := []struct {
		name string
		art  func(w http.ResponseWriter, r *http.Request)
		want int
	}{
		{"artwork", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(pink) }, http.StatusOK},
		{"a redirect to another art host", redirectTo("https://lh3.googleusercontent.com/art", pink), http.StatusOK},
		{"a redirect off the art hosts", redirectTo("https://evil.example/art", pink), http.StatusBadGateway},
		{"a picture far bigger than artwork", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(huge) }, http.StatusBadGateway},
		{"more bytes than artwork", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write(append(pink, make([]byte, maxArtBytes)...))
		}, http.StatusBadGateway},
	}
	for _, c := range cases {
		s := newTestServer()
		s.art.Transport = everyHostIs(t, c.art)
		rec := call(s, http.MethodGet, "/api/art-accent?src=https://i.ytimg.com/vi/x/hqdefault.jpg", "")
		if rec.Code != c.want {
			t.Errorf("%s: %d %s, want %d", c.name, rec.Code, rec.Body, c.want)
		}
	}
}

// redirectTo sends the first request to url and answers the next with art.
func redirectTo(url string, art []byte) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "i.ytimg.com" {
			http.Redirect(w, r, url, http.StatusFound)
			return
		}
		_, _ = w.Write(art)
	}
}

// everyHostIs is a transport that reaches handle whatever host a link
// names, so the tests see where the client would have gone.
func everyHostIs(t *testing.T, handle http.HandlerFunc) http.RoundTripper {
	t.Helper()
	srv := httptest.NewUnstartedServer(handle)
	srv.EnableHTTP2 = false
	srv.StartTLS()
	t.Cleanup(srv.Close)
	dial := func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}
	return &http.Transport{DialContext: dial, TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
}
