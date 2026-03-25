# roidy

Terminal-based adb frontend. Android version of casty.

## Stack

- Node.js (ESM)
- `@devicefarmer/adbkit` — TCP connection to Android via adb
- Kitty Graphics Protocol — display
- Polling-based screencap (burst mode on input)
- Virtual displays for multi-app support

## Structure

- `bin/roidy.js` — entrypoint (CLI, subcommands, main loop)
- `lib/adb.js` — adb connection, screencap, input, virtual display management, `adbExec` helper
- `lib/input.js` — stdin → mouse/keyboard → adb (coordinate scaling for rotation)
- `lib/kitty.js` — Kitty GP (ported from casty, with aspect ratio fitting and center alignment)
- `lib/keys.js` — key bindings
- `lib/config.js` — config loader
- `lib/setup.js` — interactive device setup (GApps detection, Play Protect, timezone validation)
- `lib/apps.js` — app resolver (aliases, package lookup)
- `lib/fdroid.js` — F-Droid API (search, install, update, package name resolution)
- `lib/cast.js` — scrcpy-server + ffmpeg streaming (rotation restart)
- `docs/` — setup guide, screenshots
- `examples/redroid-setup-12/` — Redroid setup notes and FLAG_SECURE patch script

## Commands

```bash
./bin/roidy.js              # mirror display 0 (screencap polling)
./bin/roidy.js start <app>  # app in virtual display
./bin/roidy.js cast [app]   # low-latency streaming (scrcpy + ffmpeg)
./bin/roidy.js setup        # device setup
./bin/roidy.js search/install/update/uninstall
./bin/roidy.js list/info/screenshot/restart
```

## Language Policy

Everything in English: code comments, commit messages, CLI output, error messages, log messages, help text.
No i18n needed — single language (English) throughout.
Japanese docs are provided as `.ja.md` counterparts (e.g. `README.ja.md`).
