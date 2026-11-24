// Pure helpers, no page: what the search box makes of a pasted link, and how
// the artist page's filter matches. One case per line.
import { expect, test } from "@playwright/test";

import { LinkKind, albumIdFromUrl, playlistIdFromUrl, readLink, videoIdFromUrl } from "../src/lib/links";
import { findMatch, matchesAny } from "../src/lib/match";

const ID = "dQw4w9WgXcQ";

test("videoIdFromUrl reads the shapes api.VideoIDFromURL reads", () => {
  const cases: [string, string | undefined][] = [
    [`https://music.youtube.com/watch?v=${ID}`, ID],
    [`https://www.youtube.com/watch?v=${ID}&list=PLx`, ID],
    [`m.youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}?si=abc`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://youtube.com/embed/${ID}`, ID],
    [`https://youtube.com/live/${ID}`, ID],
    [`https://youtube.com/watch?v=short`, undefined],
    [`https://vimeo.com/watch?v=${ID}`, undefined],
    [`https://youtube.com/channel/UCabc`, undefined],
    ["not a link", undefined],
  ];
  for (const [url, want] of cases) expect(videoIdFromUrl(url), url).toBe(want);
});

test("playlist and album links", () => {
  expect(playlistIdFromUrl("https://music.youtube.com/playlist?list=PLabc")).toBe("PLabc");
  expect(playlistIdFromUrl(`https://music.youtube.com/watch?v=${ID}&list=PLabc`)).toBeUndefined();
  expect(albumIdFromUrl("https://music.youtube.com/browse/MPREb_abc123")).toBe("MPREb_abc123");
  expect(albumIdFromUrl("https://music.youtube.com/browse/UCartist")).toBeUndefined();
  expect(albumIdFromUrl("https://example.com/browse/MPREb_abc123")).toBeUndefined();
});

test("readLink tells links from words", () => {
  const cases: [string, ReturnType<typeof readLink>][] = [
    [`https://music.youtube.com/watch?v=${ID}`, { kind: LinkKind.Song, videoId: ID }],
    [`youtu.be/${ID}`, { kind: LinkKind.Song, videoId: ID }],
    ["music.youtube.com/playlist?list=PLabc", { kind: LinkKind.Playlist, playlistId: "PLabc" }],
    ["https://music.youtube.com/browse/MPREb_LQwx7Jq6u9H", { kind: LinkKind.Album, albumId: "MPREb_LQwx7Jq6u9H" }],
    ["https://music.youtube.com/browse/MPREb_ab", { kind: LinkKind.OtherYouTube }], // too short for an album, as the server says
    ["https://www.youtube.com/@someone", { kind: LinkKind.OtherYouTube }],
    ["https://open.spotify.com/track/abc", { kind: LinkKind.Elsewhere }],
    ["example.com/song", { kind: LinkKind.Elsewhere }],
    ["mr.brightside", undefined],
    ["ac/dc", undefined],
    ["laut biru", undefined],
    ["", undefined],
  ];
  for (const [text, want] of cases) expect(readLink(text), text).toEqual(want);
});

test("findMatch ignores case and accents and points into the original", () => {
  expect(findMatch("Love, Pulang", "love")).toEqual([0, 4]);
  expect(findMatch("Harbour Love Song", "LOVE")).toEqual([8, 12]);
  expect(findMatch("Beyoncé – Halo", "beyonce")).toEqual([0, 7]);
  expect(findMatch("Café del Mar", "e d")).toEqual([3, 6]);
  expect(findMatch("Pasang Surut", "ombak")).toBeUndefined();
  expect(matchesAny(["Biru", "Garam"], "gar")).toBe(true);
  expect(matchesAny(["Biru", undefined], "laut")).toBe(false);
});
