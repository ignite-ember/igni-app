#!/usr/bin/env bash
# The .dmg finishing script puts the given (stapled) .app into the
# image in place of the one Tauri built, and strips the volume icon.
# macOS only (hdiutil): `make dmg-script-test`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d -t igni-dmg-test)"
MNT="$WORK/mnt"
trap 'hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

make_app() { # <dir> <marker>
  mkdir -p "$1/igni.app/Contents/MacOS"
  printf '%s' "$2" > "$1/igni.app/Contents/marker"
}

make_app "$WORK/built" built
touch "$WORK/built/.VolumeIcon.icns"
hdiutil create -quiet -fs HFS+ -volname igni -srcfolder "$WORK/built" -format UDZO "$WORK/igni.dmg"
make_app "$WORK/stapled" stapled
mkdir -p "$WORK/stapled/igni.app/Contents/_CodeSignature"
printf 'ticket' > "$WORK/stapled/igni.app/Contents/CodeResources"

"$HERE/strip-dmg-volume-icon.sh" "$WORK/igni.dmg" "$WORK/stapled/igni.app" >/dev/null

mkdir -p "$MNT"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MNT" "$WORK/igni.dmg"
fail=0
[[ "$(cat "$MNT/igni.app/Contents/marker")" == stapled ]] || { echo "FAIL: the image still holds the built .app"; fail=1; }
[[ -f "$MNT/igni.app/Contents/CodeResources" ]] || { echo "FAIL: the stapled bundle's files did not arrive"; fail=1; }
[[ ! -e "$MNT/.VolumeIcon.icns" ]] || { echo "FAIL: the volume icon is still there"; fail=1; }
hdiutil detach "$MNT" -quiet

# Without the second argument the image keeps its .app.
make_app "$WORK/plain" built
hdiutil create -quiet -fs HFS+ -volname igni -srcfolder "$WORK/plain" -format UDZO "$WORK/plain.dmg"
"$HERE/strip-dmg-volume-icon.sh" "$WORK/plain.dmg" >/dev/null
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MNT" "$WORK/plain.dmg"
[[ "$(cat "$MNT/igni.app/Contents/marker")" == built ]] || { echo "FAIL: the .app changed without a stapled one given"; fail=1; }
hdiutil detach "$MNT" -quiet

[[ $fail -eq 0 ]] && echo "ok: strip-dmg-volume-icon"
exit $fail
