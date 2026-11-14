.PHONY: dev server web build test lint app dist

## dev: run Go API (:8080) and Vite UI (:3001) side by side
dev:
	@(cd server && go run ./cmd/nimbrung $(ARGS)) & \
	(cd web && npm run dev:web); kill %1

## server: run only the Go server (serves embedded UI if built)
server:
	cd server && go run ./cmd/nimbrung $(ARGS)

## web: build the UI and copy it into the Go embed dir
web:
	cd web && npm run build
	rm -rf server/internal/web/dist && mkdir -p server/internal/web/dist
	cp -r web/apps/web/dist/. server/internal/web/dist/

## build: single binary with the UI inside → ./nimbrung
build: web
	cd server && CGO_ENABLED=0 go build -ldflags "-s -w" -o ../nimbrung ./cmd/nimbrung

# icon: AppIcon.icns from macos/AppIcon.png into the app bundle $(1)
define icon
	mkdir -p $(1)/Contents/Resources/AppIcon.iconset
	for s in 16 32 128 256 512; do \
		sips -z $$s $$s macos/AppIcon.png --out $(1)/Contents/Resources/AppIcon.iconset/icon_$${s}x$${s}.png >/dev/null; \
		sips -z $$((s*2)) $$((s*2)) macos/AppIcon.png --out $(1)/Contents/Resources/AppIcon.iconset/icon_$${s}x$${s}@2x.png >/dev/null; \
	done
	iconutil -c icns -o $(1)/Contents/Resources/AppIcon.icns $(1)/Contents/Resources/AppIcon.iconset
	rm -rf $(1)/Contents/Resources/AppIcon.iconset
endef

## app: macOS menu-bar launcher → /Applications/Nimbrung.app (runs scripts/jam.sh)
APP := /Applications/Nimbrung.app
app:
	rm -rf $(APP) && mkdir -p $(APP)/Contents/MacOS $(APP)/Contents/Resources
	swiftc -O -parse-as-library -target $$(uname -m)-apple-macos14 \
		-o $(APP)/Contents/MacOS/Nimbrung macos/Nimbrung.swift macos/Setup.swift
	$(call icon,$(APP))
	sed 's|@REPO@|$(CURDIR)|' macos/Info.plist > $(APP)/Contents/Info.plist

## dist: the app with nimbrung and jam.sh inside, for Macs without this repo
## → dist/Nimbrung.app and dist/Nimbrung.zip (universal, ad-hoc signed, not notarised).
## If swiftc can't find the SwiftUI macro plugin, pass an older SDK in SDKROOT.
DIST := dist/Nimbrung.app
dist: web
	rm -rf dist && mkdir -p dist/build $(DIST)/Contents/MacOS $(DIST)/Contents/Resources/scripts
	cd server && for a in arm64 amd64; do \
		CGO_ENABLED=0 GOOS=darwin GOARCH=$$a go build -trimpath -ldflags "-s -w" \
			-o ../dist/build/nimbrung-$$a ./cmd/nimbrung || exit 1; \
	done
	lipo -create -output $(DIST)/Contents/Resources/nimbrung dist/build/nimbrung-arm64 dist/build/nimbrung-amd64
	for a in arm64 x86_64; do \
		swiftc -O -parse-as-library -target $$a-apple-macos14 \
			-o dist/build/Nimbrung-$$a macos/Nimbrung.swift macos/Setup.swift || exit 1; \
	done
	lipo -create -output $(DIST)/Contents/MacOS/Nimbrung dist/build/Nimbrung-arm64 dist/build/Nimbrung-x86_64
	$(call icon,$(DIST))
	sed 's|@REPO@||' macos/Info.plist > $(DIST)/Contents/Info.plist
	install -m 755 scripts/jam.sh $(DIST)/Contents/Resources/scripts/jam.sh
	rm -rf dist/build
	codesign --force -s - $(DIST)/Contents/Resources/nimbrung
	codesign --force --deep -s - $(DIST) && codesign --verify --deep --strict $(DIST)
	cd dist && ditto -c -k --norsrc --keepParent Nimbrung.app Nimbrung.zip # no xattrs: unzip would turn them into ._ files that break the seal

test:
	cd server && go test ./...

lint:
	cd server && gofmt -l . && go vet ./...
	cd web && npm run check-types
