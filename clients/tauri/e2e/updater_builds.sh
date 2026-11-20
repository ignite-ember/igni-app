#!/usr/bin/env bash
# Build the two releases the updater proof updates between, signed with a
# key made here and thrown away with the runner.
#
#   updater_builds.sh <linux|windows|macos> <stage-dir>
#
# Run from the repository root by .github/workflows/updater-e2e-proof.yml.
# It never reads the release signing key or any secret: it generates two
# throwaway minisign key pairs (`test`, which the builds trust and sign
# with, and `other`, which only signs the wrong-key negative), then builds
# version A and version B with the test public key put into the build by
# `tauri build --config <overlay>`. tauri.conf.json is not changed; the
# script fails if it is.
#
# What lands in <stage-dir>:
#   manifest.json        versions and, per installer kind, the files below
#   A/                   what the proof installs (AppImage, .msi, -setup.exe, igni.app)
#   B/                   the updater payload and the .sig the build wrote
#   B-wrongkey/          B's payload signed by the other key (the .sig only)
#   keys/*.pub           both public keys (the private keys are deleted)
set -euo pipefail

PLATFORM="$1"
STAGE="$2"
CLI=(npx --yes "@tauri-apps/cli@${TAURI_CLI_VERSION:?set TAURI_CLI_VERSION}")
# Not a secret: it protects keys that exist only on this runner, for one job.
PW="updater-e2e-throwaway"

ROOT="$(pwd)"
TAURI_DIR="clients/tauri"
CONF="$TAURI_DIR/src-tauri/tauri.conf.json"
rm -rf "$STAGE"
mkdir -p "$STAGE/A" "$STAGE/B" "$STAGE/B-wrongkey" "$STAGE/keys"
STAGE="$(cd "$STAGE" && pwd)"

case "$PLATFORM" in
  linux)   BUNDLES=appimage; KINDS="appimage"; VA=1.0.5-e2e.1; VB=1.0.5-e2e.2 ;;
  # An .msi's version allows only a numeric pre-release (WiX maps it to a
  # fourth field), so Windows counts 1.0.5-1 → 1.0.5-2.
  windows) BUNDLES=msi,nsis; KINDS="msi nsis"; VA=1.0.5-1; VB=1.0.5-2 ;;
  macos)   BUNDLES=app;      KINDS="app";      VA=1.0.5-e2e.1; VB=1.0.5-e2e.2 ;;
  *) echo "unknown platform $PLATFORM" >&2; exit 2 ;;
esac

conf_sha() { node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$1"; }
CONF_SHA_BEFORE="$(conf_sha "$CONF")"

# ── the throwaway keys ────────────────────────────────────────────────
# Generated inside clients/tauri (relative paths: Git Bash hands node a
# path it can read on Windows), then moved to the stage.
KEYDIR="$TAURI_DIR/.updater-e2e-keys"
rm -rf "$KEYDIR"; mkdir -p "$KEYDIR"
(cd "$TAURI_DIR" && "${CLI[@]}" signer generate --ci -f -p "$PW" -w .updater-e2e-keys/test.key >/dev/null)
(cd "$TAURI_DIR" && "${CLI[@]}" signer generate --ci -f -p "$PW" -w .updater-e2e-keys/other.key >/dev/null)
TEST_PUB="$(tr -d '\r\n' < "$KEYDIR/test.key.pub")"
RELEASE_PUB="$(node -e 'process.stdout.write(require(process.argv[1]).plugins.updater.pubkey)' "$ROOT/$CONF")"
if [ "$TEST_PUB" = "$RELEASE_PUB" ]; then
  echo "::error::the generated key equals the release key" >&2; exit 1
fi
echo "throwaway updater key: $(printf '%s' "$TEST_PUB" | base64 -d | sed -n 1p)"
echo "release updater key:   $(printf '%s' "$RELEASE_PUB" | base64 -d | sed -n 1p) (not used)"

TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEYDIR/test.key")"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  # Throwaway, but kept out of the log all the same.
  while IFS= read -r line; do [ -n "$line" ] && echo "::add-mask::$line"; done <<<"$TAURI_SIGNING_PRIVATE_KEY"
fi
export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$PW"

# ── the two builds ────────────────────────────────────────────────────
BUNDLE_DIR="$TAURI_DIR/src-tauri/target/release/bundle"

build() {
  local version="$1"
  # The overlay is the only place the test key and version live; `tauri
  # build --config` merges it over tauri.conf.json for this build only.
  node -e '
    const [version, pubkey, out] = process.argv.slice(1);
    require("fs").writeFileSync(out, JSON.stringify({
      version,
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater: { pubkey } },
    }, null, 2));
  ' "$version" "$TEST_PUB" "$TAURI_DIR/.updater-e2e-overlay.json"
  rm -rf "$BUNDLE_DIR"
  (cd "$TAURI_DIR" && "${CLI[@]}" build --bundles "$BUNDLES" --config .updater-e2e-overlay.json)
  rm -f "$TAURI_DIR/.updater-e2e-overlay.json"
}

one() {  # the single file a glob names, or fail
  # shellcheck disable=SC2206 # the glob is the point
  local matches=( $1 )
  if [ "${#matches[@]}" -ne 1 ] || [ ! -e "${matches[0]}" ]; then
    echo "::error::expected one file for $1, found: ${matches[*]}" >&2; exit 1
  fi
  printf '%s' "${matches[0]}"
}

# Whether a build put the throwaway key, and not the release key, into the
# binary. Evidence only: a build trusting the wrong key fails the proof's
# good update anyway.
key_evidence() {
  local bin="$1" label="$2"
  local test_n release_n
  test_n=$(LC_ALL=C grep -c -a -F "$TEST_PUB" "$bin" || true)
  release_n=$(LC_ALL=C grep -c -a -F "$RELEASE_PUB" "$bin" || true)
  echo "$label binary: throwaway key found $test_n time(s), release key found $release_n time(s)"
  printf '{"throwaway_key_hits": %s, "release_key_hits": %s}' "${test_n:-0}" "${release_n:-0}" > "$STAGE/keys/$label-binary-keys.json"
}

# Staged paths, as variables A_<kind> and B_<kind> (bash 3 has no maps).
put() { eval "$1_$2=\"\$3\""; }
get() { eval "printf '%s' \"\${$1_$2}\""; }
stage_build() {
  local which="$1"   # A or B
  local bin
  case "$PLATFORM" in
    linux)
      bin="$TAURI_DIR/src-tauri/target/release/igni-app"
      local f; f="$(one "$BUNDLE_DIR/appimage/*.AppImage")"
      cp "$f" "$STAGE/$which/"; cp "$f.sig" "$STAGE/$which/"
      put "$which" appimage "$which/$(basename "$f")"
      ;;
    windows)
      bin="$TAURI_DIR/src-tauri/target/release/igni-app.exe"
      local m n; m="$(one "$BUNDLE_DIR/msi/*.msi")"; n="$(one "$BUNDLE_DIR/nsis/*-setup.exe")"
      cp "$m" "$m.sig" "$n" "$n.sig" "$STAGE/$which/"
      put "$which" msi "$which/$(basename "$m")"
      put "$which" nsis "$which/$(basename "$n")"
      ;;
    macos)
      bin="$TAURI_DIR/src-tauri/target/release/igni-app"
      local app tgz; app="$(one "$BUNDLE_DIR/macos/*.app")"; tgz="$(one "$BUNDLE_DIR/macos/*.app.tar.gz")"
      if [ "$which" = A ]; then
        ditto "$app" "$STAGE/A/$(basename "$app")"
        put A app "A/$(basename "$app")"
      else
        cp "$tgz" "$tgz.sig" "$STAGE/B/"
        put B app "B/$(basename "$tgz")"
      fi
      ;;
  esac
  key_evidence "$bin" "$which"
}

build "$VA"; stage_build A
build "$VB"; stage_build B

# ── B signed by the other key ─────────────────────────────────────────
for kind in $KINDS; do
  rel="$(get B "$kind")"
  cp "$STAGE/$rel" "$TAURI_DIR/.updater-e2e-keys/payload"
  # The CLI reads TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) as -k/-p, which
  # clashes with -f: sign with the other key and nothing from the builds.
  (cd "$TAURI_DIR" && env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
    "${CLI[@]}" signer sign -f .updater-e2e-keys/other.key -p "$PW" .updater-e2e-keys/payload >/dev/null)
  cp "$KEYDIR/payload.sig" "$STAGE/B-wrongkey/$(basename "$rel").sig"
  rm -f "$KEYDIR/payload" "$KEYDIR/payload.sig"
done

cp "$KEYDIR/test.key.pub" "$KEYDIR/other.key.pub" "$STAGE/keys/"
rm -rf "$KEYDIR"
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

if [ "$(conf_sha "$CONF")" != "$CONF_SHA_BEFORE" ]; then
  echo "::error::tauri.conf.json changed during the test builds" >&2; exit 1
fi

# ── the manifest ──────────────────────────────────────────────────────
{
  printf '{\n  "platform": "%s",\n  "version_a": "%s",\n  "version_b": "%s",\n' "$PLATFORM" "$VA" "$VB"
  printf '  "release_pubkey_untouched": true,\n  "kinds": {\n'
  first=1
  for kind in $KINDS; do
    b="$(get B "$kind")"
    [ $first -eq 1 ] || printf ',\n'
    first=0
    printf '    "%s": {"a": "%s", "b": "%s", "b_sig": "%s.sig", "b_wrong_sig": "B-wrongkey/%s.sig"}' \
      "$kind" "$(get A "$kind")" "$b" "$b" "$(basename "$b")"
  done
  printf '\n  }\n}\n'
} > "$STAGE/manifest.json"
cat "$STAGE/manifest.json"
find "$STAGE" -type f -exec ls -l {} \;
