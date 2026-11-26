#!/usr/bin/env bash
# The installed app as a person meets it on Linux: started the ordinary way
# (no WebDriver) on a desktop with a window manager and a taskbar, then a
# screenshot of the whole screen, so the window frame, its title and the
# taskbar icon are in the picture as well as the page.
#
#   desktop-shot.sh <app binary> <out dir>
#
# Run it on a display (xvfb-run). IGNI_E2E_PYTHON is the runtime the app
# starts its backend on, so the window opens without a first-launch install.
set -euo pipefail

app=$1
out=$2
mkdir -p "$out"
home=$(mktemp -d)
# The title bar names the project folder (windows/title.rs).
project="$(mktemp -d)/released-check"
mkdir -p "$project"

openbox >/dev/null 2>&1 &
tint2 >/dev/null 2>&1 &
sleep 3

HOME="$home" XDG_CONFIG_HOME="$home/.config" XDG_DATA_HOME="$home/.local/share" \
  XDG_CACHE_HOME="$home/.cache" IGNI_RUNTIME_PYTHON="$IGNI_E2E_PYTHON" \
  "$app" "$project" >"$out/app.log" 2>&1 &
pid=$!

wid=""
for _ in $(seq 1 90); do
  kill -0 "$pid" 2>/dev/null || { echo "the app exited at start"; tail -40 "$out/app.log"; exit 1; }
  wid=$(xdotool search --onlyvisible --name '^released-check' 2>/dev/null | head -1 || true)
  [ -n "$wid" ] && break
  sleep 1
done
[ -n "$wid" ] || { echo "no igni window within 90 s"; wmctrl -l || true; tail -40 "$out/app.log"; exit 1; }

# The backend starts and the chat opens.
sleep 30
title=$(xdotool getwindowname "$wid")
icon=$(xprop -id "$wid" _NET_WM_ICON | head -c 80)
import -window root "$out/desktop.png"
printf 'title: %s\nicon: %s\n' "$title" "$icon" | tee "$out/window.txt"

[[ "$title" == released-check* ]] || { echo "the window's title is '$title', not the project's folder"; exit 1; }
[[ "$icon" == *"CARDINAL"* ]] || { echo "the window has no icon (_NET_WM_ICON)"; exit 1; }
pgrep -f "igni_core.backend.*$project" >/dev/null || { echo "no backend for the project"; exit 1; }

# Close it the way a person does, then make sure the backend went with it.
wmctrl -ic "$wid"
for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
kill -0 "$pid" 2>/dev/null && { echo "the app was still running 30 s after its window was closed"; kill "$pid"; exit 1; }
for _ in $(seq 1 30); do pgrep -f "igni_core.backend.*$project" >/dev/null || break; sleep 1; done
if pgrep -f "igni_core.backend.*$project" >/dev/null; then echo "the backend outlived the app by 30 s"; exit 1; fi
echo "the app opened its window, started its backend and took it down when closed"
