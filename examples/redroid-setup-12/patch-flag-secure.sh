#!/bin/bash
# patch-flag-secure.sh — Patch services.jar to disable FLAG_SECURE
#
# Tested with:
#   Redroid 12.0.0_64only, FlagSecurePatcher r17, Magisk 30.6
#   Ubuntu 24.04 aarch64, 2026-03-21
#
# This is a snapshot of our setup process — not a maintained script.
# If versions change, you may need to adjust accordingly.
#
# What this does:
#   1. Downloads FlagSecurePatcher Magisk module (contains the paccer tool)
#   2. Pushes it to the Android device and extracts it
#   3. Patches isSecureLocked() in services.jar to always return false
#   4. Pulls the patched jar back to host
#   5. Builds a new Docker image with the patched services.jar baked in
#
# Why:
#   Some apps set FLAG_SECURE on their windows, which makes screencap and
#   scrcpy return black frames. Patching isSecureLocked in services.jar
#   disables this check system-wide.
#
# WARNING:
#   Do NOT patch isScreenCaptureAllowed or getScreenCaptureDisabled.
#   Patching those methods breaks screencap entirely (returns 0 bytes).
#   Only isSecureLocked is safe to patch.
#
# Prerequisites:
#   - Redroid container running with Magisk (su available)
#   - adb connected to the device
#   - docker available on host
#
# Usage:
#   ./patch-flag-secure.sh [base-image-name]
#
# Example:
#   ./patch-flag-secure.sh redroid/redroid:12.0.0_64only_mindthegapps_magisk

set -euo pipefail

PATCHER_VERSION="r17"
PATCHER_URL="https://github.com/j-hc/FlagSecurePatcher/releases/download/${PATCHER_VERSION}/flag-secure-patcher-${PATCHER_VERSION}.zip"
BASE_IMAGE="${1:-redroid/redroid:12.0.0_64only_mindthegapps_magisk}"
OUTPUT_IMAGE="${BASE_IMAGE}_noflag"

# Detect architecture
case $(uname -m) in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64)        ARCH=x64 ;;
  *)             echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

echo "==> Downloading FlagSecurePatcher ${PATCHER_VERSION}..."
curl -L -o /tmp/flag-secure-patcher.zip "$PATCHER_URL"

echo "==> Pushing to device..."
adb push /tmp/flag-secure-patcher.zip /sdcard/Download/

echo "==> Extracting module on device..."
adb shell "su 0 mkdir -p /data/adb/modules/flag-secure-patcher"
adb shell "su 0 unzip -o /sdcard/Download/flag-secure-patcher.zip \
  -d /data/adb/modules/flag-secure-patcher/"

echo "==> Patching services.jar (isSecureLocked only)..."
# Inject detected ARCH into the patch script
sed "s/__ARCH__/${ARCH}/" <<'PATCH_SCRIPT' | adb shell "su 0 sh"
# Stub functions for Magisk helper APIs (running outside Magisk installer)
ui_print() { echo "$1"; }
set_perm() { chown "$2:$3" "$1"; chmod "$4" "$1"; [ -n "$5" ] && chcon "$5" "$1"; }
abort() { echo "ABORT: $1"; exit 1; }

MODPATH=/data/adb/modules/flag-secure-patcher
ARCH=__ARCH__
chmod -R 755 "$MODPATH/util/"

# Only patch isSecureLocked — other methods break screencap
services_PATCHES="isSecureLocked:RET_FALSE;"

# Set up paths for the patching tools bundled in the module
LIBPATH="$MODPATH/util/lib/${ARCH}"
alias zip='LD_LIBRARY_PATH=$LIBPATH $MODPATH/util/bin/$ARCH/zip'
alias zipalign='LD_LIBRARY_PATH=$LIBPATH $MODPATH/util/bin/$ARCH/zipalign'
alias paccer='LD_LIBRARY_PATH=$LIBPATH $MODPATH/util/bin/$ARCH/paccer'

set -eu
TMPPATH="$MODPATH/tmp"
TARGET_JAR="/system/framework/services.jar"
TARGET_JAR_PATH="${MODPATH}/system/framework"
ARCH_OAT=arm64

mkdir -p "$TMPPATH" "$TARGET_JAR_PATH"
cp "$TARGET_JAR" "$TMPPATH/"

# Extract the jar (it contains dex files with Android service code)
ui_print "[+] Extracting services.jar"
mkdir "$TMPPATH/services"
unzip -q "$TMPPATH/services.jar" -d "$TMPPATH/services"

# Apply binary patch to dex files using paccer
# This changes isSecureLocked() to always return false
ui_print "[+] Patching (isSecureLocked only)"
for DEX in "$TMPPATH/services"/classes*; do
    OP=$(paccer "$DEX" "$DEX" "$services_PATCHES" 2>&1) || true
    [ "$OP" ] && ui_print "    (${DEX##*/}) $OP"
done

# Repackage the patched dex files into a new jar
ui_print "[+] Zipaligning"
cd "$TMPPATH/services/"
zip -q0r "$TMPPATH/services-patched.zip" .
cd "$MODPATH"

PATCHED_JAR="${TARGET_JAR_PATH}/services.jar"
zipalign -p -z 4 "$TMPPATH/services-patched.zip" "$PATCHED_JAR"
chown 0:0 "$PATCHED_JAR"; chmod 644 "$PATCHED_JAR"
chcon u:object_r:system_file:s0 "$PATCHED_JAR"

# Pre-compile for faster boot (dex2oat ahead-of-time compilation)
ui_print "[+] Optimizing with dex2oat"
mkdir -p "${TARGET_JAR_PATH}/oat/${ARCH_OAT}"
dex2oat --dex-file="$PATCHED_JAR" --android-root=/system \
    --instruction-set="${ARCH_OAT}" \
    --oat-file="${TARGET_JAR_PATH}/oat/${ARCH_OAT}/services.odex" \
    --app-image-file="${TARGET_JAR_PATH}/oat/${ARCH_OAT}/services.art" \
    --no-generate-debug-info --generate-mini-debug-info || true

for ext in odex vdex art; do
    f="${TARGET_JAR_PATH}/oat/${ARCH_OAT}/services.${ext}"
    [ -f "$f" ] && chown 0:0 "$f" && chmod 644 "$f" && chcon u:object_r:system_file:s0 "$f"
done

rm -r "$TMPPATH"
ui_print "[+] Patch complete"
PATCH_SCRIPT

echo "==> Pulling patched services.jar from device..."
adb shell "su 0 cp \
  /data/adb/modules/flag-secure-patcher/system/framework/services.jar \
  /sdcard/services-patched.jar"
adb pull /sdcard/services-patched.jar /tmp/services-patched.jar

echo "==> Building Docker image with patched services.jar..."
cat > /tmp/Dockerfile.flagsecure <<EOF
FROM ${BASE_IMAGE}
COPY services-patched.jar /system/framework/services.jar
EOF

docker build -t "$OUTPUT_IMAGE" -f /tmp/Dockerfile.flagsecure /tmp/

echo "==> Done!"
echo ""
echo "Image created: $OUTPUT_IMAGE"
echo ""
echo "To use it:"
echo "  docker stop redroid && docker rm redroid"
echo "  docker run -d --name redroid --privileged --restart unless-stopped -p 5555:5555 $OUTPUT_IMAGE"
