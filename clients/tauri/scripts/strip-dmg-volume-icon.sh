#!/usr/bin/env bash
# Strip the volume icon from a Tauri-built .dmg so Finder renders it
# with the generic disk-image icon instead of the bundled app icon.
#
# Tauri's bundler copies the app .icns into the DMG as
# ``.VolumeIcon.icns`` and sets the volume's ``kHasCustomIcon``
# attribute. Both are needed for Finder to show the flame on the .dmg
# file itself. Removing them (after the bundle is otherwise final)
# reverts the file icon to the system default — what users expect to
# see on a download — without touching the app icon inside.
#
# Given a second argument, the stapled .app, it also replaces the .app
# inside the image with it. Tauri builds the .dmg before the release
# job notarizes and staples the .app, so the .dmg's own copy carried no
# ticket and a first launch offline could not pass Gatekeeper (R611);
# the stapler writes the ticket into the bundle on disk, so the image
# has to be given the stapled bundle.
#
# Usage: strip-dmg-volume-icon.sh <path-to.dmg> [<stapled.app>]
#
# macOS only. Idempotent: a .dmg without a custom icon is left alone.

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <path-to.dmg> [<stapled.app>]" >&2
  exit 2
fi

DMG="$1"
if [[ ! -f "$DMG" ]]; then
  echo "error: $DMG does not exist" >&2
  exit 2
fi
APP="${2:-}"
if [[ -n "$APP" && ! -d "$APP" ]]; then
  echo "error: $APP is not an app bundle" >&2
  exit 2
fi

WORK="$(mktemp -d -t igni-dmg)"
trap 'rm -rf "$WORK"' EXIT

RW="$WORK/rw.dmg"
hdiutil convert "$DMG" -format UDRW -o "$RW" >/dev/null

# ``hdiutil attach`` prints multiple lines; the last column on the
# last line is the mount point. Use ``-nobrowse`` so Finder doesn't
# pop the volume open during CI.
MOUNT_OUTPUT="$(hdiutil attach "$RW" -nobrowse -noverify -noautoopen)"
MOUNT_POINT="$(echo "$MOUNT_OUTPUT" | awk -F'\t' 'NF>=3 { mp=$NF } END { print mp }')"
if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
  echo "error: could not determine mount point from hdiutil output:" >&2
  echo "$MOUNT_OUTPUT" >&2
  exit 1
fi

cleanup_mount() {
  hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true
}
trap 'cleanup_mount; rm -rf "$WORK"' EXIT

rm -f "$MOUNT_POINT/.VolumeIcon.icns"
# Clear the custom-icon flag on the volume so Finder falls back to the
# default disk image icon. Lowercase ``c`` clears; uppercase sets.
SetFile -a c "$MOUNT_POINT" 2>/dev/null || true

if [[ -n "$APP" ]]; then
  INSIDE="$MOUNT_POINT/$(basename "$APP")"
  if [[ ! -d "$INSIDE" ]]; then
    echo "error: the image has no $(basename "$APP") to replace" >&2
    exit 1
  fi
  rm -rf "$INSIDE"
  # ditto keeps the bundle's symlinks, xattrs and the stapled ticket.
  ditto "$APP" "$INSIDE"
  echo "replaced $(basename "$APP") in $(basename "$DMG") with $APP"
fi

cleanup_mount
trap 'rm -rf "$WORK"' EXIT

REPACK="$WORK/repack.dmg"
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$REPACK" >/dev/null
mv "$REPACK" "$DMG"

echo "stripped volume icon from $(basename "$DMG")"
