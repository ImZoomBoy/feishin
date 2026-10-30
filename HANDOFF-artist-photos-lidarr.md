# Handoff: Feishin fork with artist photos, full screen layouts and Lidarr discography

Personal fork of Feishin 1.17.0 (Electron music player) connected to the user's
Navidrome server and Lidarr. Lidarr feeds Soularr → Soulseek (slskd) for downloads.

## Where things are

| What | Where |
|---|---|
| Repo | `~/ai-development/apps/feishin` |
| Working branch | `personal/artist-photos-lidarr` (pushed to `origin`) |
| GitHub fork | https://github.com/ImZoomBoy/feishin (public, default branch `development`) |
| Upstream | https://github.com/jeffvli/feishin. The user has read-only access, so they can't merge there |
| Upstream-ready earlier branch | `feat/fullscreen-artist-backdrop` (only the first artist photo commit) |
| Installed app | `~/Applications/Feishin-artist-photos.AppImage` (run with `--ozone-platform=x11`) |
| Previous build | `~/Applications/Feishin-artist-photos.previous.AppImage` |
| Feishin settings | `~/.config/feishin` (keys and the Lidarr URL live in localStorage `store_full_screen_player`) |
| Design mockups | `~/ai-development/apps/feishin-mockups/`, served by the systemd user unit `feishin-mockups-http` on http://127.0.0.1:8765 |

The user prefers the Dracula theme and the Inter font. An unused custom theme
`~/.config/feishin/Themes/ventura-violet.json` exists; deleting it was offered, but the user hasn't answered.

## What the branch adds (8 commits on top of `development`)

1. **Rotating artist photos** in the full screen player, from fanart.tv (needs the
   user's key) and TheAudioDB, falling back to the Navidrome image. The code is in
   `src/renderer/features/player/components/artist-backdrop.tsx`, which exports
   `ArtistBackdrop` (optional `artists` prop), `useArtistInfo` and `useArtistInfoFor(name)`.
   Artist info covers the logo, formed year, country and genre.
2. **Switchable full screen layouts**: Cinema, Editorial, Classic refined, Poster,
   Artist stage and Original. Pills sit at the top and keys 1–6 switch between them. The code is in
   `full-screen-layouts.tsx` and `.module.css`, and the layout is stored in `full-screen-player.store.ts`.
   The user asked for very little text: only the title plus one line with the artist and album.
   Poster no longer shows a vinyl record, because the media type may not be vinyl.
3. **Lidarr discography**: `features/player/components/lidarr-discography.tsx` and
   `features/player/api/lidarr-api.ts`.
   - **Grouping:** Lidarr albums plus MusicBrainz release groups (singles left out),
     grouped as studio, EP, live, demo, compilation, soundtrack, other and library,
     then matched to library albums by MusicBrainz release group id, falling back to the title.
   - **Missing albums Lidarr knows about:** "+ Lidarr" monitors the album and runs AlbumSearch.
   - **Releases the artist's metadata profile excludes:** these are tagged "Not in Lidarr", and Get
     opens a confirmation dialog. After confirming, Feishin:
     1. switches the artist to the narrowest existing profile that also allows the type
        (creating one only if none fits), with `monitorNewItems: none`,
     2. runs RefreshArtist,
     3. unmonitors anything unexpected,
     4. monitors and searches just the chosen release,
     5. restores `monitorNewItems`.

     The original profile is saved in the store's `lidarrRestore`. A "Back to <profile>" link reverts it.
   - **Releases the profile already allows but Lidarr still lacks:** these are usually bootlegs,
     such as "Gorillaz: Deep Cuts", so they're hidden.
   - **MusicBrainz:** requests are throttled to about one per second, with retry and backoff on 503.
   - **Clicks:** clicking an owned album opens its album page. The round cover button plays it.
4. **Artist page hero**: `features/artists/components/artist-hero.tsx`. It shows rotating photos across the
   top, the logo in place of the name, and genre and origin in the metadata line.
   It replaces Feishin's own artist background setting on that page.
5. **Artist discography page**: `features/artists/routes/artist-discography-route.tsx`.
   "View discography" shows a photo band and every release grouped by type with Lidarr
   buttons. `?view=list` falls back to Feishin's original album list.

Translation strings are in `src/i18n/locales/en.json` under `page.fullscreenPlayer.layout`,
`page.fullscreenPlayer.discography` and `page.albumArtistDetail`.

## Build, check, install

```bash
cd ~/ai-development/apps/feishin
npx tsc --noEmit -p tsconfig.web.json --composite false
npx eslint --fix --max-warnings=0 <files>      # list files explicitly in zsh
npx stylelint --fix <css files>
env -u ELECTRON_RUN_AS_NODE npx electron-vite build \
  && npx vite build --config remote.vite.config.ts \
  && npx electron-builder --linux AppImage --publish never
git checkout -q org.jeffvli.feishin.metainfo.xml   # the build modifies this file
cp dist/Feishin-linux-x86_64.AppImage ~/Applications/Feishin-artist-photos.AppImage.new \
  && mv ~/Applications/Feishin-artist-photos.AppImage.new ~/Applications/Feishin-artist-photos.AppImage
```

`ELECTRON_RUN_AS_NODE` is set in the agent shell and must be unset for anything Electron.
The user's Feishin runs under a systemd user unit `feishin-artist-photos-<ts>`. Don't
restart it without asking, because it interrupts their music.

## Testing without touching the user's app

These helpers live in `/tmp/fs-cdp/` and may not survive a reboot:
- `start.sh` copies `~/.config/feishin` to `/tmp/fs-test-profile`, skipping the Singleton
  lock files, and launches `dist/linux-unpacked/feishin` with DevTools on port 9341. It then mutes audio by patching `HTMLMediaElement.prototype.play`.
- `stop.sh` stops the test copy and deletes the profile.
- `eval.mjs "<js>" 9341`, `shot.mjs out.jpg 9341`, `click.mjs x y 9341` and `key.mjs <key> 9341` drive the test copy over CDP.
- `L.mjs <METHOD> <path> [body]` runs a Lidarr API call from inside the test app, so keys are never printed.

Don't run `pkill -f fs-test-profile`, because the pattern also matches the agent's own shell.
The full screen expanded state persists, so check it with eval before clicking.
Saving the queue to the server is off (`general.autoSave.enabled` is false).

## Rules the user set

- Never ask for secrets in chat. Never print the API keys; read them from Feishin storage inside the app.
- Don't trigger Lidarr downloads without the user's consent. Get and + Lidarr have only been tested up to the confirm dialog.
  The profile-switch flow was verified on Portishead (switch, refresh, revert), and nothing was downloaded.
- Don't open the upstream PR without the user writing or approving the description.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Keep user-facing text short and plain. The user isn't deeply technical about code.

## Open items

- **Font style:** the user asked whether every full screen view should use Poster's style
  (heavy, all capitals) or the normal one. The recommendation was normal everywhere,
  keeping Poster's outlined artist name in capitals. Waiting on their answer.
- **Lidarr Library Import:** about 45 artists exist only in Navidrome. The user said to do this once
  the design is settled. Confirm the approach first.
- **Ideas not yet confirmed:** an "Add artist to Lidarr" button, an "Open in Aurral" link, and slskd download progress.
- **Upstream PR:** on hold, the user decides.
- **First real Get:** nobody has pressed Get through to the end yet, so watch the first one.
