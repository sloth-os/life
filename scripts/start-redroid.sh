#!/usr/bin/env bash
# Start a real Android device for the mobile end-to-end tests: redroid (Android 12 in a
# container) with a pinned, checksum-verified Chromium browser, reachable over ADB as root.
# Adapted from the speak project's scripts/ci-start-redroid.sh. Safe to re-run: a running
# device is reused. Needs Docker, the binder_linux kernel module and adb (installed if absent).
set -euo pipefail

REDROID_CONTAINER="${REDROID_CONTAINER:-life-redroid}"
REDROID_IMAGE="${REDROID_IMAGE:-redroid/redroid:12.0.0-latest}"
REDROID_ADB_PORT="${REDROID_ADB_PORT:-5555}"
REDROID_SERIAL="127.0.0.1:${REDROID_ADB_PORT}"
BROWSER_PACKAGE="org.chromium.chrome"
# Vanilla Chromium builds published with Cromite releases (same pin as speak).
BROWSER_RELEASE_URL="https://github.com/uazo/cromite/releases/download/v147.0.7727.56-271900671db643de04aa9f909f0dcc3415c8b827"
PLATFORM_TOOLS_URL="https://dl.google.com/android/repository/platform-tools-latest-linux.zip"

log() { echo "[redroid] $*" >&2; }
as_root() { if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo "$@"; fi; }

ensure_binder() {
  if as_root modprobe binder_linux devices=binder,hwbinder,vndbinder 2>/dev/null; then
    return
  fi
  local package="linux-modules-extra-$(uname -r)"
  log "binder_linux unavailable; installing $package"
  as_root timeout 90s env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=2 update >/dev/null
  as_root timeout 180s env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$package" >/dev/null
  as_root modprobe binder_linux devices=binder,hwbinder,vndbinder
}

ensure_adb() {
  if command -v adb >/dev/null 2>&1; then
    return
  fi
  local dir
  if [[ -x "${ANDROID_HOME:-/nonexistent}/platform-tools/adb" ]]; then
    dir="$ANDROID_HOME/platform-tools"
  else
    local tmp
    tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/platform-tools.XXXXXX")"
    log "downloading Android Platform-Tools"
    curl --fail --location --retry 2 --silent --show-error --output "$tmp/platform-tools.zip" "$PLATFORM_TOOLS_URL"
    unzip -q "$tmp/platform-tools.zip" -d "$tmp"
    dir="$tmp/platform-tools"
  fi
  export PATH="$dir:$PATH"
  # Later CI steps (and Playwright) need adb on their PATH too.
  if [[ -n "${GITHUB_PATH:-}" ]]; then echo "$dir" >> "$GITHUB_PATH"; fi
  log "using adb from $dir"
}

start_container() {
  if [[ "$(docker inspect -f '{{.State.Running}}' "$REDROID_CONTAINER" 2>/dev/null || true)" == "true" ]]; then
    log "reusing running container $REDROID_CONTAINER"
    return
  fi
  docker rm -f "$REDROID_CONTAINER" >/dev/null 2>&1 || true
  log "starting $REDROID_IMAGE as $REDROID_CONTAINER (ADB on $REDROID_SERIAL)"
  docker run -d --privileged --name "$REDROID_CONTAINER" \
    -p "127.0.0.1:${REDROID_ADB_PORT}:5555" \
    "$REDROID_IMAGE" \
    androidboot.redroid_width=1080 androidboot.redroid_height=2340 androidboot.redroid_dpi=420 >/dev/null
}

wait_for_boot() {
  adb start-server >/dev/null
  for _ in $(seq 1 120); do
    adb connect "$REDROID_SERIAL" >/dev/null 2>&1 || true
    if [[ "$(adb -s "$REDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
      log "Android booted"
      return
    fi
    sleep 2
  done
  docker logs --tail 100 "$REDROID_CONTAINER" >&2 || true
  log "timed out waiting for Android to boot"
  return 1
}

ensure_root() {
  for _ in $(seq 1 15); do
    adb -s "$REDROID_SERIAL" root >/dev/null 2>&1 && break
    sleep 1
  done
  for _ in $(seq 1 30); do
    adb connect "$REDROID_SERIAL" >/dev/null 2>&1 || true
    if [[ "$(adb -s "$REDROID_SERIAL" shell id -u 2>/dev/null | tr -d '\r')" == "0" ]]; then
      return
    fi
    sleep 1
  done
  log "ADB shell must run as root"
  return 1
}

install_browser() {
  if adb -s "$REDROID_SERIAL" shell pm path "$BROWSER_PACKAGE" >/dev/null 2>&1; then
    log "$BROWSER_PACKAGE already installed"
    return
  fi
  local abi asset sha
  abi="$(adb -s "$REDROID_SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')"
  case "$abi" in
    x86_64*) asset="x64_VanillaChromium.apk" sha="0b72f3a9ce8c538607d4c46b36a7839e0ae2da39dfcd8451691a8c17458f0f5e" ;;
    arm64*) asset="arm64_VanillaChromium.apk" sha="a71d01ca76ded6d682ba3ab8721e383cbda954412db7555921e79595bc36f635" ;;
    *) log "unsupported ABI $abi"; return 1 ;;
  esac
  local apk
  apk="$(mktemp --suffix=.apk)"
  log "downloading $asset"
  curl --fail --location --retry 4 --retry-all-errors --silent --show-error --max-time 300 \
    --output "$apk" "$BROWSER_RELEASE_URL/$asset"
  if [[ "$(sha256sum "$apk" | cut -d' ' -f1)" != "$sha" ]]; then
    rm -f "$apk"
    log "checksum mismatch for $asset"
    return 1
  fi
  adb -s "$REDROID_SERIAL" install -r "$apk" >/dev/null
  rm -f "$apk"
  log "installed $BROWSER_PACKAGE ($asset)"
}

ensure_binder
ensure_adb
start_container
wait_for_boot
ensure_root
for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb -s "$REDROID_SERIAL" shell settings put global "$setting" 0 >/dev/null || true
done
install_browser
if [[ -n "${GITHUB_ENV:-}" ]]; then echo "ANDROID_BROWSER_PACKAGE=$BROWSER_PACKAGE" >> "$GITHUB_ENV"; fi
echo "Android device ready: $REDROID_SERIAL with $BROWSER_PACKAGE"
