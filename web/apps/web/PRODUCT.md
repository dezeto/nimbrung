# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Guests** (primary): people in the room at a party. Standing, dim room, phone in one hand, want a song added in about ten seconds. They scan a QR and use a web page: no account, no app. (Confirmed by the owner, 2026-11-24.)
- **Host**: runs the YouTube Music desktop app on a laptop plugged into a speaker, shares the QR, sets the rules.
- Remote friends can join over a tunnel link, but the in-room guest is the one to design for.

## Product Purpose

A self-hosted "jam" for YouTube Music. Guests pick a nickname, search songs, add them to the host's queue, remove their own, and vote to skip. Success is a guest getting the song they have in mind into the queue without help.

## Positioning

The host's own YouTube Music player is the source of truth; Nimbrung only annotates its queue (who added what) and enforces the rules. Nothing to install for guests, nothing hosted for the host. *Nimbrung* (Indonesian): to join in on something already going.

## Operating Context

- Guests arrive by QR code on their own phones, mid-party, already talking to someone.
- A TV in the room may show `/room` (now playing, next three songs, join QR).
- The player's autoplay keeps the music going when the queue runs out.

## Capabilities and Constraints

- Search covers songs, videos and playlists; playlists open to add songs one by one. Links from YouTube and YouTube Music can be pasted or shared in.
- Rules: adds per minute per guest (host exempt), skip votes needed, optional ask-to-join. Duplicates of now-playing and up-next are refused.
- Saved songs and recent searches live in the guest's browser only, never on the server.
- No database and no accounts. The jam lives in memory, with one JSON state file for restarts.
- Known friction (owner, 2026-11-24): guests often know the artist they want but not the song.

## Brand Commitments

- Look: Liquid Glass. Glass only on the floating layer; rows plain on a blurred backdrop of the current artwork. Follows the OS light and dark setting.
- Red `#FF3B3B` for icons, `#D62B30` for filled buttons, `#FF6B63` for red text. Inter.
- Mockups and tokens in `docs/design/liquid-glass` are the reference.

## Evidence on Hand

- Mockups: `docs/design/liquid-glass/*.dc.html` (Search, Saved, Queue, Host, Join).
- No usage data or guest research beyond the owner's observation above. Do not invent any.

## Product Principles

1. The player's queue is the truth; the UI never pretends otherwise.
2. A guest needs no account, no app and no instructions.
3. Adding a song takes seconds, one-handed.
4. Songs go in one at a time; nobody dumps a whole album or playlist.
5. What a guest keeps (saved songs, recent searches) stays on their phone.
