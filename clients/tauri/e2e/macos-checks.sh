#!/usr/bin/env bash
# macOS checks for igni's .app, run headless on a CI runner. Scenario ids
# are docs/ENTERPRISE_TEST_PLAN.md's. There is no WebDriver for WKWebView,
# so the window is not driven: the bundle is inspected, launched with a
# provisioned runtime, followed to its backend, sent an igni:// link, quit
# and killed, and the screen is captured at each step.
#
#   macos-checks.sh <path/to/igni.app> <python with igni-core>
set -euo pipefail

APP="$1"
PYTHON="$2"
OUT="${IGNI_E2E_OUT:-desktop-e2e-out}/macos"
mkdir -p "$OUT"
PLIST="$APP/Contents/Info.plist"
SCENARIOS=()
fail() { echo "FAIL: $*" >&2; SCENARIOS+=("| $CURRENT | **FAIL** — $* |"); summary; exit 1; }
pass() { echo "pass: $CURRENT"; SCENARIOS+=("| $CURRENT | pass |"); }
summary() {
  {
    echo "### Desktop E2E — macOS"
    echo
    echo "| Scenario | Result |"
    echo "|---|---|"
    printf '%s\n' "${SCENARIOS[@]}"
    echo
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
}
shot() { screencapture -x "$OUT/$1.png" 2>/dev/null || true; }

CURRENT="PLAT-003 Info.plist registers igni://, the identifier and the minimum macOS"
plutil -p "$PLIST" | tee "$OUT/Info.plist.txt"
/usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes:0:CFBundleURLSchemes" "$PLIST" | grep -qx '    igni' \
  || fail "CFBundleURLTypes does not list the igni scheme"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")" = "sh.ignite-ember.desktop" ] \
  || fail "CFBundleIdentifier is not sh.ignite-ember.desktop"
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$PLIST")" = "26.0" ] \
  || fail "LSMinimumSystemVersion is not 26.0"
pass

CURRENT="PLAT-002 the bundle's signature verifies (ad-hoc in CI; Developer ID in a release)"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tee "$OUT/codesign-verify.txt" \
  || fail "codesign --verify --deep --strict failed"
codesign -dv --verbose=4 "$APP" 2>&1 | tee "$OUT/codesign-display.txt" >/dev/null
pass

CURRENT="PLAT-004 the signed entitlements are exactly entitlements.plist's"
codesign -d --entitlements :- "$APP" 2>/dev/null > "$OUT/entitlements.signed.plist" || true
want=$(plutil -convert json -o - "$(dirname "$0")/../src-tauri/entitlements.plist" | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin)))')
have=$(plutil -convert json -o - "$OUT/entitlements.signed.plist" 2>/dev/null | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin)))' || echo "none")
echo "want: $want"; echo "have: $have"
[ "$want" = "$have" ] || fail "signed entitlements $have differ from entitlements.plist $want"
pass

# A HOME of its own, a project, the scripted model and a signed-in user.
ROOT=$(mktemp -d)
export HOME="$ROOT/home"
PROJECT="$ROOT/project"
mkdir -p "$HOME/.igni" "$PROJECT"
echo "# macOS e2e project" > "$PROJECT/README.md"
MODEL_PORT_FILE="$ROOT/model.port"
"$PYTHON" "$(dirname "$0")/../../../scripts/e2e/scripted_model.py" --port 0 --port-file "$MODEL_PORT_FILE" \
  > "$OUT/scripted-model.out" 2>&1 &
MODEL_PID=$!
for _ in $(seq 1 100); do [ -s "$MODEL_PORT_FILE" ] && break; sleep 0.2; done
[ -s "$MODEL_PORT_FILE" ] || { cat "$OUT/scripted-model.out"; echo "the scripted model did not start" >&2; exit 1; }
MODEL_PORT=$(cat "$MODEL_PORT_FILE")
cat > "$HOME/.igni/config.yaml" <<YAML
runtime_python: $PYTHON
models:
  default: e2e-scripted
  registry:
    e2e-scripted:
      provider: openai_like
      model_id: e2e-scripted
      url: http://127.0.0.1:$MODEL_PORT/v1
      context_window: 8192
      vision: false
YAML
python3 - "$HOME/.igni/credentials.json" <<'PY'
import json, sys, datetime
now = datetime.datetime.now(datetime.timezone.utc)
json.dump({"access_token": "macos-e2e-fixture-token", "token_type": "bearer", "email": "mac@example.com",
           "created_at": now.isoformat(), "expires_at": (now + datetime.timedelta(days=365)).isoformat()},
          open(sys.argv[1], "w"))
PY

BIN="$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST")"
backend_pids() { pgrep -f "igni_core.backend.*$PROJECT" || true; }

CURRENT="PLAT-001 ENT-015 the app starts its backend on the provisioned runtime, with no download"
"$BIN" "$PROJECT" > "$OUT/app.out" 2> "$OUT/app.err" &
APP_PID=$!
for _ in $(seq 1 120); do [ -n "$(backend_pids)" ] && break; sleep 1; done
sleep 5
shot "01-launched"
[ -n "$(backend_pids)" ] || { cat "$OUT/app.err"; fail "no igni_core.backend for the project within 120 s"; }
ps -o pid=,command= -p "$(backend_pids | head -1)" | tee "$OUT/backend-ps.txt"
grep -q "$PYTHON" "$OUT/backend-ps.txt" || fail "the backend is not running on runtime_python"
[ ! -d "$HOME/Library/Caches/igni/venv" ] || fail "a managed venv was created despite runtime_python"
pass

CURRENT="SEC-020 the window token is in the backend's environment, never on its command line"
if grep -q "igni-token\|IGNI_WS_TOKEN=" "$OUT/backend-ps.txt"; then fail "a token is on the backend's command line"; fi
pass

CURRENT="EXT-006 PLAT-003 an igni:// link reaches the running app (LaunchServices)"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
open "igni://open?open=plugins"
sleep 5
shot "02-after-deep-link"
# One app, one backend: the link was handed to the running app rather
# than starting a second one.
[ "$(pgrep -f "$BIN" | wc -l | tr -d ' ')" -le 1 ] || fail "the link started a second app instead of reaching the running one"
[ "$(backend_pids | wc -l | tr -d ' ')" -eq 1 ] || fail "expected exactly one backend after the link"
pass

CURRENT="ENT-032 quitting the app stops its backend"
osascript -e 'tell application id "sh.ignite-ember.desktop" to quit' || kill -TERM "$APP_PID"
for _ in $(seq 1 30); do [ -z "$(backend_pids)" ] && break; sleep 1; done
[ -z "$(backend_pids)" ] || fail "backend still running 30 s after quit"
pass

CURRENT="ENT-032 a crashed app (SIGKILL) takes its backend down through the parent-PID watchdog"
"$BIN" "$PROJECT" >> "$OUT/app.out" 2>> "$OUT/app.err" &
APP_PID=$!
for _ in $(seq 1 120); do [ -n "$(backend_pids)" ] && break; sleep 1; done
[ -n "$(backend_pids)" ] || fail "no backend on the second launch"
kill -KILL "$APP_PID"
for _ in $(seq 1 30); do [ -z "$(backend_pids)" ] && break; sleep 1; done
[ -z "$(backend_pids)" ] || fail "backend outlived a killed app by 30 s"
pass

kill "$MODEL_PID" 2>/dev/null || true
summary
