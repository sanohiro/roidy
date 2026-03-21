# roidy

Terminal-based adb frontend — view and control Android devices from your terminal using Kitty graphics protocol.

Each app runs in its own virtual display, so you can use multiple apps simultaneously in separate terminal windows.

## Prerequisites

### Node.js

Node.js 18 or later.

### adb (Android Debug Bridge)

```bash
# macOS
brew install android-platform-tools

# Ubuntu / Debian
sudo apt install android-tools-adb

# Windows — download Android SDK Platform-Tools from developer.android.com
```

You need an Android environment accessible via adb. Any of the following will work:

- **Physical device** (USB connection)
- **Android Studio Emulator (AVD)**
- **Genymotion** or other third-party emulators
- **Redroid** (Docker-based headless Android)

For a fully headless setup, we recommend **Redroid** — that's what we use for development and testing.
Note that Redroid depends on the Linux kernel's binder driver, so it's **Linux only**.

### Terminal

A terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/):

- [Kitty](https://sw.kovidgoyal.net/kitty/)
- [Ghostty](https://ghostty.org/)
- [WezTerm](https://wezfurlong.org/wezterm/)

## Install

```bash
npm install -g @sanohiro/roidy
```

## Usage

```bash
# Mirror the entire Android screen
roidy

# Launch an app in its own virtual display
roidy start kindle
roidy start settings

# Specify host and port
roidy --host 192.168.1.100 --port 5555

# Change capture interval (ms)
roidy --interval 500
```

## Commands

```bash
roidy                    # Mirror Android screen (display 0)
roidy start <app>        # Launch app in virtual display
roidy list               # List installed apps
roidy search <query>     # Search F-Droid for apps
roidy install <pkg|apk>  # Install from F-Droid or local APK
roidy update             # Update all apps via F-Droid
roidy uninstall <pkg>    # Uninstall an app
roidy info               # Show device info
roidy screenshot [file]  # Save screenshot (alias: ss)
roidy restart            # Restart system UI (zygote)
roidy setup              # Interactive device setup
```

### roidy start

Launches an app in its own virtual display. Multiple apps can run simultaneously in separate terminal windows.

```bash
# Use short aliases
roidy start kindle
roidy start settings

# Use full package names
roidy start com.amazon.kindle

# Partial match
roidy start amazon

# Fallback to main display (if virtual display doesn't work)
roidy start kindle --display 0
```

### roidy setup

Interactive setup for a fresh Android device. All prompts default to no change, so it's safe to run repeatedly.

```bash
# Interactive mode
roidy setup

# Non-interactive with flags
roidy setup -t Asia/Tokyo -l ja-JP --clock 24 --screen-timeout 0 --screen-lock off

# Skip app installation prompts
roidy setup -t Asia/Tokyo -l ja-JP --no-install
```

Setup options:
- Timezone, locale, clock format
- Screen timeout, screen lock
- Launcher (KISS Launcher, Discreet Launcher)
- F-Droid (open-source app store)

### roidy search / install / update

Manage apps via F-Droid without touching the screen.

```bash
# Search for apps
roidy search browser
roidy search keyboard

# Install from F-Droid
roidy install org.mozilla.fennec_fdroid

# Install local APK
roidy install ./app.apk

# Update all F-Droid apps
roidy update

# Uninstall
roidy uninstall fennec
```

## Key bindings

| Key | Action |
|-----|--------|
| Ctrl+Q | Quit |
| Escape | Android Back |
| Mouse click | Tap |
| Mouse drag | Swipe |
| Scroll | Scroll |
| Arrow keys | D-pad |
| Text input | Text input |

## Config

Customize settings in `~/.roidy/config.json`:

```json
{
  "host": "localhost",
  "port": 5555,
  "interval": 1000
}
```

Key bindings can be customized in `~/.roidy/keys.json`.

## Redroid setup (Linux)

Redroid requires the binder kernel module:

```bash
# Load the kernel module
sudo modprobe binder_linux

# Persist across reboots
echo "binder_linux" | sudo tee /etc/modules-load.d/redroid.conf

# Start Redroid container
docker run -d --name redroid --privileged \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only-latest
```

### Google Play (GApps)

If you need apps that depend on Google Play Services (e.g. Kindle), use [redroid-script](https://github.com/ayasa520/redroid-script) to build a GApps-enabled image:

```bash
git clone https://github.com/ayasa520/redroid-script.git
cd redroid-script
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 redroid.py -a 12.0.0_64only -mtg -m -c docker
```

Then start with the custom image:

```bash
docker run -d --name redroid --privileged \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only_mindthegapps_magisk
```

For apps without Google Play dependencies, F-Droid is sufficient — install apps via `roidy install` without any screen interaction.

## License

MIT
