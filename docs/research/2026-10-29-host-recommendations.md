# Keeping a jam out of the host's YouTube Music taste

Researched 2026-10-29 against pear-desktop v3.12.0 (Electron 42.5.0) and the
YouTube Music web client served that day. Links in `[brackets]` resolve to the
source list at the bottom. "Unverified" means no primary source or test backs it.

## Answer first

Play jams on a separate identity: a **Brand Account that the host owns**, used
only for jams. Google says YouTube purchases "are then accessible from any channel
owned by that account" [yt-6312076], so Premium should carry over, and a Brand
Account keeps its own watch and search history [yt-3056283]. Every signal a jam
makes (plays, searches, skips, autoplay) then lands on the jam identity, not the
host's. Autoplay keeps working, because YouTube Music seeds its radio from the
song that is playing (see option 1).

One-time setup:

1. Sign in to YouTube with the Premium account. Go to your channel list, click
   **Create a channel**, and give it a name such as "Friday jam". This creates
   a Brand Account that you own [yt-3056283].
2. In pear-desktop, click your profile picture, then **Switch account**, then pick
   the jam account. Play one song. If no ads play, Premium carried over.
3. For each jam: switch to the jam account before you start nimbrung, and switch
   back after. To skip the switching, keep a second pear-desktop profile on the
   jam account (option 5).

Fallback if the host won't make a Brand Account: in My Activity, turn off
**YouTube History** before the jam and turn it back on after [yt-95725]. This
covers plays and searches and keeps Premium and autoplay. It is manual, and it is
easy to forget to turn history back on.

## Comparison

| Option | Protects recommendations? | Keeps Premium? | Keeps autoplay? | Effort per jam | Can nimbrung automate it? |
|---|---|---|---|---|---|
| 1. Pause YouTube History | Plays: yes. Searches: only if search history is paused too. Likes: no. Skips and queue context: not documented | Yes | Yes. Some personalized Home stations may hide | Turn off before, on after. Must remember | Not through the API Server. Only with a forked plugin or DevTools calling an undocumented endpoint (option 7). Fragile |
| 2a. Brand Account for jams | Yes. Separate identity, so every signal | Yes, documented for owners. Check once | Yes. It learns the jam's taste over time | Switch account twice. None with a second profile | Not needed. The API Server cannot switch accounts |
| 2b. Second Google account | Yes | Only as a member of the host's family plan (same household). Otherwise ads | Yes | Sign out and in, or use a second profile | Not needed |
| 3. Delete the jam's history after | Partly. It shapes recommendations until you delete it | Yes | Yes | One filtered delete. Also deletes the host's own plays and searches from that window | No supported way found |
| 4. "Exclude from taste profile" | Not available in YouTube Music | n/a | n/a | n/a | n/a |
| 5. pear-desktop setting or flag | No history switch exists. `--user-data-dir` gives a separate profile, which helps 2a, 2b and 6 | Depends on the account | Yes | Start the jam profile instead | Not needed |
| 6. Logged out | Yes. Nothing is saved to an account | No. Ads, no 18+ tracks, no audio quality choice | Yes, but not personalized | Sign out and in, or use a profile that never signs in | Not needed |
| 7. Nimbrung pauses and resumes history | Same as 1 | Yes | Yes | None, if it works | Possible but fragile |
| 8. Extra: nimbrung searches anonymously | Searches only | Yes | n/a | None | Yes. A change in nimbrung itself |

## 1. Pausing YouTube watch history

**Where to toggle it**

- YouTube Music app: profile picture, then Settings, then Privacy & location, then
  **Pause watch history** [ytm-6364666].
- My Activity: YouTube History, then the Controls tab, then **Turn off**. While
  the control is on, you can pick what it saves: "Include the YouTube videos you
  watch", "Include your searches on YouTube", "Include YouTube voice and audio
  activity" [yt-95725].
- youtube.com: History, then **Pause watch history** [yt-95725].
- pear-desktop (the YouTube Music web app): the web client has a settings toggle
  named `setWatchHistoryPausedSettingEndpoint` [ytm-bundle]. Google's YouTube
  Music page gives only app steps, so the exact desktop menu label is unverified.

**Does a pause protect recommendations?**

- Yes, for plays. "When you pause your watch history, videos that you watch won't
  show in your watch history or be used to improve your recommendations"
  [ytm-6364666].
- Google suggests a pause for this exact case: turn history off "when you don't
  want your watches or searches to influence future recommendations ... Remember
  to resume your history when you're done" [yt-6342839].
- Recap: watch history from a paused period "is not included in your Recap"
  [ytm-11418178].
- Replay Mix: no Google page found. Unverified.

**What it does not cover**

- Searches are a separate setting: "Include your searches on YouTube" [yt-57711].
  The YouTube Music web client's main bundle has endpoints to pause and resume
  watch history and to clear search history, but none to pause search history
  [ytm-bundle]. So the
  YouTube Music toggle alone probably leaves guest searches in the host's history.
  Turning off the whole YouTube History control in My Activity covers both
  [yt-95725].
- Nimbrung's guest searches run inside the host's signed-in app: nimbrung calls
  the plugin's `/api/v1/search` [nimbrung-client], which calls YouTube Music's
  `/search` with the host's session [pear-renderer]. Whether these searches land
  in the host's YouTube search history is unverified, but likely.
- Likes are a separate signal: "Your recommendations and search results are also
  based on videos that you've liked" [yt-6342839]. A pause does not touch them.
  Nimbrung never likes or dislikes [nimbrung-client], but the host's own likes
  during a jam still count.
- Skips, queue adds and the "playing from" context: no Google page says whether
  these are signals, or whether a pause covers them. Unverified.

**Does it hurt autoplay?**

- Google mentions one side effect: "Some personalized stations may also not show
  in the Home tab" [ytm-6364666]. Nothing says autoplay changes.
- The radio is seeded from the song. On 2026-10-29 an anonymous
  `POST /youtubei/v1/next` (WEB_REMIX client, no cookies) for one song returned
  an `automixPlaylistVideoRenderer` pointing at playlist `RDAMVM<videoId>`. So
  autoplay works with no history at all.
- Signed-in autoplay is personal to some degree: nimbrung's own code notes that
  its anonymous guess "only partly matches what the app goes on to play"
  [nimbrung-autoplay]. Whether that personal part fades while history is paused
  is unverified.

**Scope and sync**

- "Watch history settings are shared between YouTube and YouTube Music. If you
  pause your watch history while signed in to YouTube, it will also be paused on
  YouTube Music when signed in with the same account" [ytm-6364666].
- It is a My Activity control, so it is per Google Account [yt-95725]. Whether
  each Brand Account has its own pause setting is unverified.
- A pause lasts until you resume it [yt-6342839]. If the host forgets, their own
  listening stops shaping recommendations and Recap.

## 2. A separate account for jams

### 2a. Brand Account (recommended)

- A Brand Account is "different from your personal Google Account". You create
  one when you create a YouTube channel [yt-3056283]. Brand Accounts created
  after August 4, 2021 are "limited to YouTube" [acc-7001996], which is all a jam
  needs.
- It has its own history. Google lists "Watch & search history" among what a
  Brand Account loses in a channel transfer [yt-3056283]. This is implied, not
  stated outright.
- Premium: "YouTube purchases are linked to the account you use to sign in, and
  are then accessible from any channel owned by that account." Also: "Brand
  Account managers will not have access to YouTube Premium membership benefits
  for a channel that they do not own" [yt-6312076]. The host creates the Brand
  Account, so the host is its owner. No YouTube Music page says this
  specifically, so check for ads on first use.
- Switching: on youtube.com, profile picture, then **Switch account**, lists the
  Brand Accounts you manage [yt-3046356]. Google has no YouTube Music steps. The
  YouTube Music web client contains the account switcher code
  (`selectActiveIdentityEndpoint`, `channelDelegationRole`) [ytm-bundle].
  pear-desktop runs Google sign-in inside its own window [pear-index-redirect],
  so the in-app avatar menu is the place to switch. Clicking through it in
  pear-desktop is unverified.
- Side effects: creating it makes a public YouTube channel with that name
  [yt-3056283]. Delegate users on a Brand Account get no YouTube Recap
  [yt-16723638]. The host is the owner, so this does not apply.
- Autoplay keeps working (seeded from the song, option 1). It starts with no
  taste of its own and learns the jams' taste over time.

### 2b. A second Google account

- With a YouTube family plan, members "Use their own Google account to access a
  shared membership" and "Have their own personal library, subscriptions, and
  recommendations" [yt-7507349].
- Rules: up to 5 members, all at the same residential address, not in another
  family group, no Google Workspace accounts [yt-7507349]. Whether one person may
  add their own second account is not addressed. Unverified.
- Without a family plan, the second account is on the free tier, so music plays
  with ads [ytm-9266556].
- pear-desktop has one Google session per profile. You sign out and back in, or
  keep a second profile (option 5).

## 3. Deleting the jam's history afterwards

- How: in My Activity, filter by date and by product, then **Delete**, then
  **Delete results** [acc-465]. In YouTube History, Delete with a time range also
  works: "Using DELETE to delete your watch history will also delete your search
  history from the selected time frame" [yt-95725].
- Effect: "If you delete some or all of your watch history, YouTube won't base
  future video recommendations on that content" [yt-95725]. "Search entries you
  delete will no longer influence your recommendations" [yt-57711]. Google says
  it first "aim[s] to remove it from view and the data may no longer be used to
  personalize your Google experience" [acc-465].
- Limits:
  - The jam shapes recommendations until the host deletes it. How fast Home and
    mixes recover after a delete is unverified.
  - A time-range delete also removes the host's own plays and searches from that
    window.
  - Likes are not history, so a delete does not remove them [yt-6342839].
- Auto-delete cannot target a party. It offers only fixed ages: "after 3, 18, or
  36 months" [yt-57711]. You "click the button for how long you want to keep your
  activity" [acc-465].
- The YouTube Music app can delete single items: Settings, then Privacy &
  location, then Manage watch history [ytm-6364666].
- Automation: the web client deletes single history items by sending feedback
  tokens to `/youtubei/v1/feedback` [ytm-bundle]. That means scraping the history
  page item by item. Fragile, and not recommended.

## 4. "Exclude from taste profile" features

- YouTube Music documents only per-item feedback on Home: long-press, then **Not
  interested**, **Don't recommend artist** or **Don't recommend channel**. You can
  delete that feedback under Settings, then Privacy & data, then Manage my
  feedback. "Removing content from YouTube Music does not impact your
  recommendations on YouTube" [yt-13401025]. No per-playlist or per-session
  exclusion is documented.
- The web client has nothing that looks like one either. Its only "taste" page
  is `tasteprofile`, which maps to browse ID `FEmusic_tastebuilder` [ytm-bundle].
  Nothing in the client excludes content.
- Incognito exists only in the YouTube mobile app: "When logged in to the YouTube
  app, you can now turn on Incognito." While on, "the YouTube app behaves as if
  you aren't signed in to your account" [yt-9040743]. No Google page mentions
  incognito for YouTube Music. The YouTube Music web client contains an
  "incognito" icon but no incognito mode [ytm-bundle]. So it is not available on
  the web or in pear-desktop.

## 5. pear-desktop itself

- No plugin pauses history, offers incognito, or manages profiles. Checked
  against every folder in `src/plugins` [pear-plugins] and each plugin's
  description [pear-en].
- **Do Not Track** is not a history switch. In 3.12.0 it was renamed from
  "adblocker" (a config migration moves `plugins.adblocker` to
  `plugins.do-not-track`) [pear-store]. It is off by default. Its "In player"
  mode deletes `playerAds`, `adPlacements` and `adSlots` from player responses
  [pear-dnt] [pear-dnt-inject]. Using a custom block list to stop YouTube's
  playback pings, and so stop history, is untested. What else that would break is
  unverified.
- **Disable Autoplay** only "Makes song start in 'paused' mode" [pear-en]. It
  does not turn off radio. Leave it off.
- **Music Together** shares a playlist with other pear-desktop users [pear-en].
  Not relevant here.
- CLI: pear-desktop defines no flags of its own. It appends Chromium switches
  [pear-index-switches] and handles `youtubemusic://` links, which map only to
  playback and queue controls [pear-protocol] [pear-controls]. The config has no
  history, incognito or profile option [pear-defaults].
- A separate profile works through Chromium's `--user-data-dir`:
  - Electron reads `--user-data-dir` at startup and overrides the user-data path
    [electron-main-delegate].
  - `app.getPath('userData')` is that path [electron-app-getpath]. `sessionData`, which
    holds cookies, defaults to it [electron-paths] [electron-app-docs].
  - The single-instance lock is taken in that directory [electron-app-cc].
    pear-desktop takes that lock at start and exits if it can't get it
    [pear-index-lock].
  - So a second `--user-data-dir` should get its own cookies, Google sign-in,
    plugin settings and lock. Electron's list of supported switches does not
    mention `--user-data-dir` [electron-switches], so this rests on Electron's
    source code. It is not tested with pear-desktop.
- How to run a jam profile on macOS (unverified end to end):

  ```sh
  open -n -a "YouTube Music" --args --user-data-dir="$HOME/Library/Application Support/YouTube Music Jam"
  ```

  `-n` opens a new instance and `--args` passes the rest to the app (macOS
  `man open`). In that profile, sign in or switch to the jam account, and enable
  API Server on another port, for example 26539 (default 26538
  [pear-api-config]). Then run
  `./nimbrung -ytm http://127.0.0.1:26539 -token-file "$HOME/Library/Application Support/nimbrung/token-jam"`.
  Both flags exist in nimbrung [nimbrung-main]. The tray, global shortcuts and
  the `youtubemusic://` handler may clash when both profiles run at once. The
  simplest plan is to run one profile at a time.

## 6. Logged-out playback

- Protects: nothing is saved to any account.
- Ads: playing without ads is a Premium benefit [ytm-9266556]. pear-desktop's Do
  Not Track "In player" mode strips ad fields [pear-dnt-inject]. Whether that
  stops today's YouTube Music ads is unverified.
- Age-restricted tracks: "Age-restricted videos are not viewable to users who are
  under 18 years of age or signed out" [yt-2802167].
- Audio quality: "YouTube Music Premium members can select the bitrate". Without
  a choice it is "Normal", an upper bound of 128 kbps. High is up to 256 kbps
  [ytm-9076559] [yt-6308116]. That page describes the app. The web player's
  logged-out bitrate is unverified.
- Autoplay: it still works with no account (the anonymous `/next` test in
  option 1), but it is not personalized.
- Region: where YouTube Music is restricted, YouTube redirects to `/premium`, and
  pear-desktop sends you to Google sign-in instead [pear-index-redirect]. So
  logged-out playback may not work there at all.
- The host's library, likes and playlists are not available.

## 7. Automating the pause from nimbrung

- **API Server**: its routes cover playback, like and dislike, volume, shuffle,
  repeat, fullscreen, queue, search and song info. There is nothing for history
  or accounts [pear-api-routes]. The `youtubemusic://` handler exposes the same
  kind of controls [pear-controls].
- **The endpoint**: the web client turns the settings toggle into a call. When
  `boolValue` is true it POSTs `/youtubei/v1/history/pause_watch_history`. When
  false it POSTs `/youtubei/v1/history/resume_watch_history`. The body is the
  endpoint data the server sent with the settings page, plus click-tracking
  context. The settings page comes from `/youtubei/v1/account/get_setting`
  [ytm-bundle]. From the minified client:

  ```js
  this.JSC$12641_innertubePath=a.boolValue?"/history/pause_watch_history":"/history/resume_watch_history"
  ```

- **A custom pear-desktop plugin**: pear-desktop's renderer already calls YouTube
  Music endpoints with the host's session through
  `document.querySelector('ytmusic-app').networkManager.fetch(path, body)`, for
  `/search`, `/music/get_queue` and `/next` [pear-renderer] [pear-lyrics-ytm]
  [pear-app-element]. A plugin could call `/history/pause_watch_history` the same
  way. But plugins are compiled in: the build globs `src/plugins/*`
  [pear-plugin-importer]. So this means a fork of pear-desktop, rebuilt for every
  upstream release, plus an HTTP route for nimbrung (patch API Server or add a
  new one).
- **Without a fork**: start pear-desktop with `--remote-debugging-port`
  [electron-switches] and let nimbrung run the same call over the Chrome DevTools
  Protocol. That opens a local port that can drive the host's Google session. It
  also needs a WebSocket client, and nimbrung is stdlib-only Go [nimbrung-claude].
- **How fragile**: high.
  - The endpoint is undocumented and lives in minified code that changes with
    each YouTube Music release.
  - The body fields the server expects are unverified. The real toggle sends
    whatever the server put in the endpoint, possibly a token.
  - It is unverified whether it pauses only "videos you watch" or the whole
    YouTube History control.
  - Failures are silent. A failed pause leaks the jam into history. A failed
    resume, for example after a nimbrung crash, leaves the host paused with no
    end date. Nimbrung would have to read the state back from
    `/account/get_setting` and parse it.
- Verdict: possible, but not worth it next to 2a.

## 8. Extra: keep guest searches anonymous

- Today guest searches use the host's session through the plugin
  [nimbrung-claude] [nimbrung-client]. Nimbrung already asks YouTube Music
  anonymously for autoplay and playlists through its `youtubei` helper
  [nimbrung-autoplay] [nimbrung-playlist].
- Sending search through that helper too would keep guest searches out of the
  host's account under every option above. It would also drop the plugin's
  one-search-at-a-time limit [nimbrung-claude].
- Trade-offs: results are not personalized. Whether anonymous search hides
  age-restricted tracks is unverified.

## Open questions and unverified points

- Premium on a Brand Account in YouTube Music: Google documents this for "YouTube
  purchases" in general [yt-6312076], not for YouTube Music in particular. Check
  that no ads play on first use.
- The pear-desktop avatar menu: does **Switch account** list Brand Accounts? The
  switcher code is in the web client [ytm-bundle], but nobody clicked through it
  for this note.
- Does each Brand Account have its own pause-history setting and its own search
  history? Implied by [yt-3056283], not stated.
- Does the YouTube Music "Pause watch history" toggle pause only watches, or the
  whole YouTube History control?
- Do guest searches made through the plugin land in the host's YouTube search
  history?
- Are skips, queue adds and the "playing from" context recommendation signals?
  No Google page says.
- Does signed-in autoplay become less personal while history is paused?
- Replay Mix: no Google page found on how it uses history, pauses or deletes.
- How fast do Home and mixes recover after a delete?
- What body does `/history/pause_watch_history` need?
- Does a second pear-desktop profile (`--user-data-dir`) run cleanly next to the
  first (tray, shortcuts, protocol handler)?
- Can a Brand Account play age-restricted tracks?
- May one person add their own second Google account to their family plan?

## Sources

[ytm-6364666]: https://support.google.com/youtubemusic/answer/6364666?hl=en
[yt-95725]: https://support.google.com/youtube/answer/95725?hl=en
[yt-57711]: https://support.google.com/youtube/answer/57711?hl=en
[yt-6342839]: https://support.google.com/youtube/answer/6342839?hl=en
[yt-13401025]: https://support.google.com/youtube/answer/13401025?hl=en
[yt-9040743]: https://support.google.com/youtube/answer/9040743?hl=en
[ytm-11418178]: https://support.google.com/youtubemusic/answer/11418178?hl=en
[yt-16723638]: https://support.google.com/youtube/answer/16723638?hl=en
[yt-6312076]: https://support.google.com/youtube/answer/6312076?hl=en
[yt-3056283]: https://support.google.com/youtube/answer/3056283?hl=en
[yt-3046356]: https://support.google.com/youtube/answer/3046356?hl=en
[acc-7001996]: https://support.google.com/accounts/answer/7001996?hl=en
[yt-7507349]: https://support.google.com/youtube/answer/7507349?hl=en
[ytm-9266556]: https://support.google.com/youtubemusic/answer/9266556?hl=en
[acc-465]: https://support.google.com/accounts/answer/465?hl=en
[yt-2802167]: https://support.google.com/youtube/answer/2802167?hl=en
[ytm-9076559]: https://support.google.com/youtubemusic/answer/9076559?hl=en
[yt-6308116]: https://support.google.com/youtube/answer/6308116?hl=en
[ytm-bundle]: https://music.youtube.com/s/ad9b01d0/music_polymer_inlined_html.js
[pear-plugins]: https://github.com/pear-devs/pear-desktop/tree/v3.12.0/src/plugins
[pear-en]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/i18n/resources/en.json
[pear-store]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/config/store.ts#L22-L31
[pear-dnt]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/plugins/do-not-track/index.ts#L48-L54
[pear-dnt-inject]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/plugins/do-not-track/injectors/inject.ts#L35-L54
[pear-index-lock]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/index.ts#L67-L70
[pear-index-switches]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/index.ts#L100-L170
[pear-index-redirect]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/index.ts#L511-L564
[pear-protocol]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/providers/protocol-handler.ts
[pear-controls]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/providers/song-controls.ts#L42-L142
[pear-defaults]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/config/defaults.ts#L11-L40
[pear-api-config]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/plugins/api-server/config.ts#L19-L30
[pear-api-routes]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/plugins/api-server/backend/routes/control.ts
[pear-renderer]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/renderer.ts#L190-L308
[pear-lyrics-ytm]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/plugins/synced-lyrics/providers/YTMusic.ts#L110-L123
[pear-app-element]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/src/types/music-player-app-element.ts
[pear-plugin-importer]: https://github.com/pear-devs/pear-desktop/blob/v3.12.0/vite-plugins/plugin-importer.mts#L21-L30
[electron-main-delegate]: https://github.com/electron/electron/blob/v42.5.0/shell/app/electron_main_delegate.cc#L242-L251
[electron-app-cc]: https://github.com/electron/electron/blob/v42.5.0/shell/browser/api/electron_api_app.cc#L1049-L1074
[electron-app-getpath]: https://github.com/electron/electron/blob/v42.5.0/shell/browser/api/electron_api_app.cc#L419-L422
[electron-paths]: https://github.com/electron/electron/blob/v42.5.0/shell/common/electron_paths.cc#L47-L49
[electron-app-docs]: https://www.electronjs.org/docs/latest/api/app#appgetpathname
[electron-switches]: https://www.electronjs.org/docs/latest/api/command-line-switches
[nimbrung-client]: ../../server/internal/ytm/client.go
[nimbrung-autoplay]: ../../server/internal/ytm/autoplay.go
[nimbrung-playlist]: ../../server/internal/ytm/playlist.go
[nimbrung-main]: ../../server/cmd/nimbrung/main.go
[nimbrung-claude]: ../../CLAUDE.md

Reference-style links do not show in rendered Markdown, so here is the same list
as plain URLs:

- YouTube Music: pause watch history: https://support.google.com/youtubemusic/answer/6364666?hl=en
- YouTube: view, delete, or turn off watch history: https://support.google.com/youtube/answer/95725?hl=en
- YouTube: search history: https://support.google.com/youtube/answer/57711?hl=en
- YouTube: manage recommendations: https://support.google.com/youtube/answer/6342839?hl=en
- YouTube Music: find music, "Not interested": https://support.google.com/youtube/answer/13401025?hl=en
- YouTube: incognito on mobile: https://support.google.com/youtube/answer/9040743?hl=en
- YouTube Music: Recap: https://support.google.com/youtubemusic/answer/11418178?hl=en
- YouTube: Recap: https://support.google.com/youtube/answer/16723638?hl=en
- YouTube: Premium as a Brand Account manager: https://support.google.com/youtube/answer/6312076?hl=en
- YouTube: move a channel between Brand Accounts: https://support.google.com/youtube/answer/3056283?hl=en
- YouTube: switch between channels: https://support.google.com/youtube/answer/3046356?hl=en
- Google Account: manage your Brand Account: https://support.google.com/accounts/answer/7001996?hl=en
- YouTube: family plan: https://support.google.com/youtube/answer/7507349?hl=en
- YouTube Music: Premium benefits: https://support.google.com/youtubemusic/answer/9266556?hl=en
- Google Account: delete your activity: https://support.google.com/accounts/answer/465?hl=en
- YouTube: age-restricted content: https://support.google.com/youtube/answer/2802167?hl=en
- YouTube Music: audio quality: https://support.google.com/youtubemusic/answer/9076559?hl=en
- YouTube: Premium benefits: https://support.google.com/youtube/answer/6308116?hl=en
- YouTube Music web client, as served 2026-10-29 (minified, the path changes per release): https://music.youtube.com/s/ad9b01d0/music_polymer_inlined_html.js
- pear-desktop v3.12.0 source: https://github.com/pear-devs/pear-desktop/tree/v3.12.0
- Electron v42.5.0 source: https://github.com/electron/electron/tree/v42.5.0
- Electron app API: https://www.electronjs.org/docs/latest/api/app
- Electron command-line switches: https://www.electronjs.org/docs/latest/api/command-line-switches
