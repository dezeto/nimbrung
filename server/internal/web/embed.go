// Package web embeds the built guest UI (web/apps/web/dist, copied here by
// `make web`) so the whole app ships as one binary.
package web

import (
	"embed"
	"errors"
	"io/fs"
)

// dist is populated by `make web`; an empty directory is kept in git so the
// package always compiles.
//
//go:embed all:dist
var dist embed.FS

// ErrNotBuilt is returned when the UI hasn't been built into the binary.
var ErrNotBuilt = errors.New("web: dist/index.html missing — run `make web`")

// Dist returns the built UI rooted at dist/.
func Dist() (fs.FS, error) {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, err
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, ErrNotBuilt
	}
	return sub, nil
}
