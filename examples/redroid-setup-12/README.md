# Redroid Setup Example (Android 12)

This is how we set up our Redroid environment. Not a maintained guide — just our notes.
If versions change or things break, adjust accordingly.

Tested: Ubuntu 24.04 aarch64, Docker CE 27.x, Redroid 12.0.0_64only, MindTheGapps, Magisk 30.6, FlagSecurePatcher r17 (2026-03-21)

```bash
##
# Android SDK Platform Tools (skip if already installed)
##
sudo apt install android-tools-adb

##
# Docker (skip if already installed)
##
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker $USER
newgrp docker

##
# binder kernel module — Redroid needs this
##
sudo modprobe binder_linux
echo "binder_linux" | sudo tee /etc/modules-load.d/redroid.conf

##
# Build GApps + Magisk image using redroid-script
# https://github.com/ayasa520/redroid-script
#
# If you don't need Google Play Services, skip this and use
# redroid/redroid:12.0.0_64only-latest instead
##
git clone https://github.com/ayasa520/redroid-script.git /tmp/redroid-script
cd /tmp/redroid-script
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# MindTheGapps (-mtg) because OpenGapps only supports 11.0.0
# Magisk (-m) for root access
# -> redroid/redroid:12.0.0_64only_mindthegapps_magisk
python3 redroid.py -a 12.0.0_64only -mtg -m -c docker

##
# Start container
# --restart unless-stopped: auto-start on system reboot
##
docker run -d --name redroid --privileged --restart unless-stopped \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only_mindthegapps_magisk

# Wait for boot
adb connect localhost:5555
adb wait-for-device
adb shell getprop sys.boot_completed  # "1" means ready

##
# roidy setup — timezone, locale, launcher, etc.
# GApps setup wizard is automatically detected and skipped
##
roidy setup --skip-wizard --disable-play-protect \
  -t Asia/Tokyo -l ja-JP --clock 24 --screen-timeout 0 --screen-lock off
# or just: roidy setup (interactive)

##
# Done. You can now use roidy.
##
```

## FLAG_SECURE Patch (Optional)

Some apps set FLAG_SECURE and the screen goes black. If you need those apps,
run `patch-flag-secure.sh`.
> This script is in `examples/redroid-setup-12/`

The script patches `services.jar` in the Docker image

`redroid/redroid:12.0.0_64only_mindthegapps_magisk`

using [FlagSecurePatcher](https://github.com/j-hc/FlagSecurePatcher), and bakes it into a new Docker image

`redroid/redroid:12.0.0_64only_mindthegapps_magisk_noflag`

```bash
./patch-flag-secure.sh
# Restart with the patched image
docker stop redroid && docker rm redroid
docker run -d --name redroid --privileged --restart unless-stopped \
  -p 5555:5555 \
  redroid/redroid:12.0.0_64only_mindthegapps_magisk_noflag
```
