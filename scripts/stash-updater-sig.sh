#!/usr/bin/env bash
# Stash one bundle's updater signature for release.yml's `updater-json`.
#
#   scripts/stash-updater-sig.sh <appimage|msi|nsis> <bundle-dir> <out-dir>
#
# Run by a build leg right after tauri-action, from the repository root.
# Writes <out-dir>/updater.sig (the .sig tauri-bundler wrote next to the
# bundle, with `createUpdaterArtifacts: true`: base64 of a minisign
# signature, the form latest.json carries) and <out-dir>/asset (the bundle's
# file name, which tauri-action v1 uploads it to the release under).
#
# With RELEASE_TAG and GH_TOKEN set it also checks that the release holds an
# asset of that name and its .sig, so latest.json can only point at a file
# the release serves. The macOS leg has its own steps (the stapled tarball)
# and does not use this.
set -euo pipefail

KIND="$1"
BUNDLE_DIR="$2"
OUT="$3"

case "$KIND" in
  appimage) PATTERN="appimage/*.AppImage" ;;
  msi)      PATTERN="msi/*.msi" ;;
  nsis)     PATTERN="nsis/*-setup.exe" ;;
  *) echo "::error::unknown bundle kind $KIND" >&2; exit 2 ;;
esac

shopt -s nullglob
# shellcheck disable=SC2206 # the glob is the point
matches=( "$BUNDLE_DIR"/$PATTERN )
if [ "${#matches[@]}" -ne 1 ]; then
  echo "::error::expected one $KIND bundle under $BUNDLE_DIR, found ${#matches[@]}: ${matches[*]:-none}" >&2
  exit 1
fi
BUNDLE="${matches[0]}"
SIG="$BUNDLE.sig"
if [ ! -s "$SIG" ]; then
  echo "::error::$SIG is missing or empty: was the build signed (TAURI_SIGNING_PRIVATE_KEY) with createUpdaterArtifacts on?" >&2
  exit 1
fi
ASSET="$(basename "$BUNDLE")"

if [ -n "${RELEASE_TAG:-}" ] && [ -n "${GH_TOKEN:-}" ]; then
  uploaded="$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets -q '.assets[].name')"
  for want in "$ASSET" "$ASSET.sig"; do
    if ! grep -Fxq "$want" <<<"$uploaded"; then
      echo "::error::the release has no asset named $want; it has: $(tr '\n' ' ' <<<"$uploaded")" >&2
      exit 1
    fi
  done
fi

mkdir -p "$OUT"
tr -d '\r\n' < "$SIG" > "$OUT/updater.sig"
printf '%s\n' "$ASSET" > "$OUT/asset"
echo "stashed $KIND: asset $ASSET, signature $(wc -c < "$OUT/updater.sig" | tr -d ' ') bytes"
