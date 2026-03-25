# roidy setup — Configuration Guide

`roidy setup` configures an Android device for use with roidy. It's not required — roidy works without it — but it makes the experience smoother.

All prompts default to no change (just press Enter to skip), so it's safe to run multiple times.

## GApps Settings

These settings only appear when Google Play Services is detected on the device.

### Skip Setup Wizard

GApps images include a setup wizard that takes over the screen on first boot. In headless environments (no physical display), this causes a black screen because the wizard waits for user interaction that can't happen.

Skipping it sets `device_provisioned=1` and disables the wizard package.

CLI: `--skip-wizard`

### Disable Play Protect

Google Play Protect blocks installation of apps from sources other than the Play Store. This includes F-Droid and any APK installed via `roidy install` or `adb install`.

If Play Protect is enabled, installs will either fail silently or hang waiting for a confirmation dialog on the Android screen.

CLI: `--disable-play-protect`

## General Settings

### Timezone

Sets the device timezone. Validated against the device's timezone database — invalid values are rejected with a prompt to try again.

Examples: `Asia/Tokyo`, `America/New_York`, `Europe/London`, `UTC`

CLI: `-t` or `--timezone`

### Locale

Sets the display language and region. Not validated — Android accepts any locale string and falls back gracefully if unsupported.

Examples: `ja-JP`, `en-US`, `zh-CN`, `ko-KR`, `de-DE`

CLI: `-l` or `--locale`

### Clock Format

`24` for 24-hour clock, `12` for 12-hour (AM/PM).

CLI: `--clock`

### Screen Timeout

Time in seconds before the screen turns off. `0` for never.

For roidy use, `0` (never) is recommended — otherwise the screen turns off during idle periods and screencap returns a black image.

CLI: `--screen-timeout`

### Screen Lock

`on` to enable, `off` to disable.

For roidy use, `off` is recommended — screen lock requires unlock interaction that's difficult to do from a terminal.

CLI: `--screen-lock`

## App Installation

### F-Droid

[F-Droid](https://f-droid.org/) is an open-source app store. Installing it enables `roidy install`, `roidy search`, and `roidy update` for managing apps without screen interaction.

CLI: `--app-store`

### Launcher

The default Android launcher may not be ideal for terminal use. roidy offers two alternatives:

- **KISS Launcher** — Minimal, search-based. Fast and lightweight.
- **Discreet Launcher** — Privacy-focused, simple interface.

The selected launcher is set as the default home app, with permissions auto-granted.

CLI: `--launcher <name>`

## Non-interactive Mode

Pass all options as flags to skip prompts entirely:

```bash
roidy setup \
  --skip-wizard --disable-play-protect \
  -t Asia/Tokyo -l ja-JP \
  --clock 24 --screen-timeout 0 --screen-lock off \
  --app-store --no-install
```

Use `--no-install` to skip F-Droid and launcher installation prompts.
