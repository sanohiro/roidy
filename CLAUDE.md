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
- `lib/adb.js` — adb connection, screencap, input, virtual display management
- `lib/input.js` — stdin → mouse/keyboard → adb
- `lib/kitty.js` — Kitty GP (ported from casty)
- `lib/keys.js` — key bindings
- `lib/config.js` — config loader
- `lib/setup.js` — interactive device setup
- `lib/apps.js` — app resolver (aliases, package lookup)
- `lib/fdroid.js` — F-Droid API (search, install, update)

## Commands

```bash
./bin/roidy.js              # mirror display 0
./bin/roidy.js start <app>  # app in virtual display
./bin/roidy.js setup        # device setup
./bin/roidy.js search/install/update/uninstall
./bin/roidy.js list/info/screenshot/restart
```

## Language Policy

Everything in English: code comments, commit messages, CLI output, error messages, log messages, help text.
No i18n needed — single language (English) throughout.
Japanese docs are provided as `.ja.md` counterparts (e.g. `README.ja.md`).
