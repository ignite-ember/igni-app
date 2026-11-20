# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "selenium==4.53.0",
#   "psutil==7.2.2",
#   "pywinauto==0.6.9; sys_platform == 'win32'",
#   "pillow==12.0.0; sys_platform == 'win32'",
# ]
# ///
"""Drive the real, built igni desktop app and prove the campaign's desktop rows.

Run by ``.github/workflows/desktop-e2e-proof.yml`` on Linux, Windows and
macOS runners. It launches the release build (or the installed MSI, or the
AppImage), drives its webview through WebDriver (``tauri-driver``, which
fronts WebKitWebDriver on Linux and msedgedriver on Windows; macOS has no
WebDriver for WKWebView, so there it works without one), drives the native
menu bar and dialogs through the platform's accessibility API (AT-SPI on
Linux, UI Automation on Windows, System Events on macOS), and checks the
processes the app starts with ``psutil``.

Every check is written to ``<out>/verdicts.json`` as it is made, with the
campaign row it proves. The exit status is non-zero if any check failed.

Nothing secret is printed: the per-launch WebSocket token is read from the
window's URL and used, but only its length and a hash prefix are logged.

Rows: R612 R613 R617 R618 R619 R620 R622 R624 R628 R632 (see the workflow).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
from pathlib import Path

import psutil

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")

APP_NAMES = {"igni-app", "igni", "igni-app.exe", "igni.exe"}
STUB_MODEL = "e2e-desktop-stub"
COMPOSER_READY_JS = (
    "const e = document.querySelector('.composer-editable');"
    "return !!(e && /Message (Ember|igni)/.test(e.dataset.placeholder || ''));"
)
TAURI_ORIGIN = "http://tauri.localhost" if IS_WIN else "tauri://localhost"

# Native strings the shell shows, from src/error.rs, src/menu.rs and
# src/diagnostics.rs.
DIAG_TITLE = "Backend Diagnostics"
ATTACHED_REINSTALL = "can't be reinstalled from here"
ATTACHED_RESTART = "can't be restarted from here"
ATTACHED_PREFIX = "This window is attached to a backend started by another igni client"


# ─── the record ────────────────────────────────────────────────────────


class Proof:
    """Every check, with its row, flushed to disk as it is made."""

    def __init__(self, out: Path, platform: str):
        self.out = out
        self.platform = platform
        self.results: list[dict] = []
        out.mkdir(parents=True, exist_ok=True)

    def _add(self, row: str, check: str, status: str, detail: str) -> bool:
        entry = {
            "row": row,
            "check": check,
            "status": status,
            "detail": detail,
            "platform": self.platform,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        self.results.append(entry)
        print(f"[{status}] {row} · {check}" + (f" :: {detail}" if detail else ""), flush=True)
        self.flush()
        return status == "PASS"

    def check(self, row: str, check: str, ok: bool, detail: str = "") -> bool:
        return self._add(row, check, "PASS" if ok else "FAIL", detail)

    def info(self, row: str, check: str, detail: str) -> None:
        self._add(row, check, "INFO", detail)

    def blocked(self, row: str, check: str, why: str) -> None:
        self._add(row, check, "BLOCKED", why)

    def flush(self) -> None:
        (self.out / "verdicts.json").write_text(json.dumps(self.results, indent=2), encoding="utf-8")
        summary: dict[str, dict[str, int]] = {}
        for r in self.results:
            summary.setdefault(r["row"], {}).setdefault(r["status"], 0)
            summary[r["row"]][r["status"]] += 1
        (self.out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")

    def failed(self) -> bool:
        return any(r["status"] == "FAIL" for r in self.results)


def fingerprint(secret: str) -> str:
    return f"len={len(secret)} sha256[:8]={hashlib.sha256(secret.encode()).hexdigest()[:8]}"


def wait_for(fn, timeout: float, interval: float = 0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
        except Exception:
            last = None
        if last:
            return last
        time.sleep(interval)
    return last


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ─── a model that answers, and a proxy that tells ─────────────────────


class StubModel(http.server.BaseHTTPRequestHandler):
    """An OpenAI-compatible endpoint that echoes the ``TKN…`` marker of the
    last user message, so a reply proves the chat reached the backend."""

    requests: list[dict] = []

    def log_message(self, *args):  # quiet
        pass

    def _reply_text(self, body: dict) -> str:
        text = ""
        for msg in body.get("messages", []) or []:
            if msg.get("role") == "user":
                content = msg.get("content")
                if isinstance(content, list):
                    content = " ".join(p.get("text", "") for p in content if isinstance(p, dict))
                text = str(content or "")
        found = re.findall(r"TKN[A-Z0-9]+", text)
        return f"Echo {found[-1]}" if found else "STUB-OK"

    def do_GET(self):
        body = json.dumps({"object": "list", "data": [{"id": STUB_MODEL, "object": "model"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            body = {}
        StubModel.requests.append({"path": self.path, "stream": bool(body.get("stream"))})
        if not self.path.rstrip("/").endswith("chat/completions"):
            self.send_response(404)
            self.end_headers()
            return
        text = self._reply_text(body)
        created = int(time.time())
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

            def chunk(delta, finish=None, usage=None):
                payload = {
                    "id": "chatcmpl-stub",
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": STUB_MODEL,
                    "choices": [] if usage else [{"index": 0, "delta": delta, "finish_reason": finish}],
                }
                if usage:
                    payload["usage"] = usage
                self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
                self.wfile.flush()

            chunk({"role": "assistant", "content": ""})
            chunk({"content": text})
            chunk({}, finish="stop")
            chunk({}, usage={"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return
        body = json.dumps(
            {
                "id": "chatcmpl-stub",
                "object": "chat.completion",
                "created": created,
                "model": STUB_MODEL,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ProbeFiles(http.server.BaseHTTPRequestHandler):
    """A loopback origin for the CSP probes: counts what reached it."""

    hits: list[str] = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        ProbeFiles.hits.append(self.path)
        body = b"window.__cspExternal = 'ran';"
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ConnectProxy(socketserver.ThreadingTCPServer):
    """An HTTP CONNECT proxy that writes down who asked for which host.

    Each request is attributed to the local process that opened it, by
    the client port, so "the app asked github.com" is a fact about the
    app and not about whatever else runs on the machine. Hosts in
    ``refuse`` get a 502 (the mirror the update policy names does not
    exist); every other host is tunnelled.
    """

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, port: int, refuse: set[str]):
        self.log: list[dict] = []
        self.refuse = refuse
        self.lock = threading.Lock()
        super().__init__(("127.0.0.1", port), ConnectHandler)

    def mark(self) -> int:
        with self.lock:
            return len(self.log)

    def since(self, mark: int) -> list[dict]:
        with self.lock:
            return list(self.log[mark:])


def owner_of(client_port: int, server_port: int) -> tuple[int | None, str]:
    for proc in psutil.process_iter(["name"]):
        try:
            for conn in proc.net_connections(kind="tcp"):
                if conn.laddr and conn.laddr.port == client_port and conn.raddr and conn.raddr.port == server_port:
                    return proc.pid, proc.info["name"] or ""
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    return None, ""


class ConnectHandler(socketserver.BaseRequestHandler):
    def handle(self):
        sock: socket.socket = self.request
        sock.settimeout(30)
        data = b""
        while b"\r\n\r\n" not in data and len(data) < 65536:
            chunk = sock.recv(4096)
            if not chunk:
                return
            data += chunk
        line = data.split(b"\r\n", 1)[0].decode("latin-1")
        parts = line.split()
        if len(parts) < 2:
            return
        method, target = parts[0], parts[1]
        host, _, port = target.rpartition(":") if method == "CONNECT" else (urllib.parse.urlsplit(target).hostname or "", "", "80")
        pid, pname = owner_of(self.client_address[1], self.server.server_address[1])
        refused = host in self.server.refuse or method != "CONNECT"
        with self.server.lock:
            self.server.log.append(
                {"t": time.time(), "method": method, "host": host, "port": port, "pid": pid, "process": pname, "refused": refused}
            )
        if refused:
            sock.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            return
        try:
            upstream = socket.create_connection((host, int(port)), timeout=15)
        except OSError:
            sock.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            return
        sock.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        sock.settimeout(None)
        upstream.settimeout(None)

        def pump(src, dst):
            try:
                while True:
                    buf = src.recv(65536)
                    if not buf:
                        break
                    dst.sendall(buf)
            except OSError:
                pass
            finally:
                for s in (src, dst):
                    try:
                        s.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

        t = threading.Thread(target=pump, args=(upstream, sock), daemon=True)
        t.start()
        pump(sock, upstream)
        t.join(timeout=60)


def serve(handler_or_server, port: int):
    server = handler_or_server if isinstance(handler_or_server, socketserver.BaseServer) else http.server.ThreadingHTTPServer(("127.0.0.1", port), handler_or_server)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ─── processes ─────────────────────────────────────────────────────────


def app_processes(since: float = 0.0) -> list[psutil.Process]:
    out = []
    for proc in psutil.process_iter(["name", "create_time"]):
        try:
            if (proc.info["name"] or "").lower() in APP_NAMES and proc.info["create_time"] >= since - 2:
                out.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return out


def cmdline(proc: psutil.Process) -> list[str]:
    try:
        return proc.cmdline()
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return []


def backend_tree(app_pid: int) -> list[psutil.Process]:
    try:
        kids = psutil.Process(app_pid).children(recursive=True)
    except psutil.NoSuchProcess:
        return []
    return [k for k in kids if "igni_core.backend" in " ".join(cmdline(k))]


def listening_port(proc: psutil.Process) -> int | None:
    try:
        for conn in proc.net_connections(kind="tcp"):
            if conn.status == psutil.CONN_LISTEN and conn.laddr and conn.laddr.ip in ("127.0.0.1", "::1"):
                return conn.laddr.port
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        pass
    return None


def backend_leaf(app_pid: int) -> tuple[psutil.Process, int] | None:
    """The backend process that listens (on Windows the venv launcher's
    child), and its port."""
    for proc in backend_tree(app_pid):
        port = listening_port(proc)
        if port:
            return proc, port
    return None


def established_clients(proc: psutil.Process, port: int) -> int:
    try:
        return sum(
            1
            for c in proc.net_connections(kind="tcp")
            if c.status == psutil.CONN_ESTABLISHED and c.laddr and c.laddr.port == port
        )
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return 0


def kill_tree(pid: int) -> None:
    try:
        root = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return
    procs = root.children(recursive=True) + [root]
    for p in procs:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
    psutil.wait_procs(procs, timeout=10)


def alive(pid: int) -> bool:
    try:
        p = psutil.Process(pid)
        return p.status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


# ─── WebSocket handshakes, from outside the app ───────────────────────


def ws_handshake(port: int, protocols: list[str] | None, origin: str | None) -> tuple[int, str]:
    """Open a WebSocket upgrade to the backend and return (status, the
    subprotocol it selected)."""
    key = base64.b64encode(os.urandom(16)).decode()
    lines = [
        "GET / HTTP/1.1",
        f"Host: 127.0.0.1:{port}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
    ]
    if origin:
        lines.append(f"Origin: {origin}")
    if protocols:
        lines.append("Sec-WebSocket-Protocol: " + ", ".join(protocols))
    with socket.create_connection(("127.0.0.1", port), timeout=10) as s:
        s.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
    head = data.split(b"\r\n\r\n", 1)[0].decode("latin-1")
    status = int(head.split()[1]) if head.split()[1:] else 0
    selected = ""
    for line in head.split("\r\n")[1:]:
        k, _, v = line.partition(":")
        if k.strip().lower() == "sec-websocket-protocol":
            selected = v.strip()
    return status, selected


# ─── native UI, per platform ──────────────────────────────────────────


class NativeUI:
    """Menus, dialogs, a folder pick and keystrokes, through the platform's
    accessibility API. Each method returns plain data; a failure is an
    exception the scenario turns into a FAIL with the reason."""

    def menus(self, pid: int) -> dict[str, list[dict]]:
        raise NotImplementedError

    def click(self, pid: int, menu: str, item: str, window: str | None = None) -> None:
        raise NotImplementedError

    def dialog(self, pid: int, title: str, timeout: float = 25, dismiss: bool = True) -> str:
        raise NotImplementedError

    def pick_folder(self, pid: int, path: str) -> None:
        raise NotImplementedError

    def key(self, pid: int, combo: str, window: str | None = None) -> None:
        raise NotImplementedError

    def focus(self, pid: int, window: str) -> None:
        raise NotImplementedError

    def screenshot(self, path: Path) -> None:
        pass


class LinuxUI(NativeUI):
    def __init__(self, helper: Path):
        self.helper = helper

    def _run(self, *argv: str, timeout: float = 90) -> dict:
        res = subprocess.run(["/usr/bin/python3", str(self.helper), *argv], capture_output=True, text=True, timeout=timeout)
        lines = [l for l in res.stdout.splitlines() if l.strip().startswith("{")]
        if not lines:
            raise RuntimeError(f"atspi helper said nothing: rc={res.returncode} stderr={res.stderr[-800:]}")
        out = json.loads(lines[-1])
        if not out.get("ok"):
            raise RuntimeError(f"atspi {argv[0]}: {out.get('error')} {out.get('windows', '')}")
        return out

    def menus(self, pid):
        out = self._run("menus", "--pid", str(pid), "--timeout", "40")
        return out["bars"][0]["menus"]

    def click(self, pid, menu, item, window=None):
        argv = ["click", "--pid", str(pid), "--menu", menu, "--item", item, "--timeout", "40"]
        if window:
            argv += ["--window-name", window]
        self._run(*argv)

    def dialog(self, pid, title, timeout=25, dismiss=True):
        argv = ["dialog", "--pid", str(pid), "--title", title, "--timeout", str(timeout)]
        if not dismiss:
            argv.append("--keep")
        out = self._run(*argv, timeout=timeout + 30)
        return out["title"] + "\n" + out["text"]

    def pick_folder(self, pid, path):
        self._run("pick", "--pid", str(pid), "--path", path, "--timeout", "30")

    def _window(self, pid, name=None) -> str | None:
        argv = ["xdotool", "search", "--onlyvisible", "--pid", str(pid)]
        if name:
            argv += ["--name", re.escape(name)]
        res = subprocess.run(argv, capture_output=True, text=True, timeout=20)
        ids = res.stdout.split()
        return ids[-1] if ids else None

    def focus(self, pid, window):
        wid = self._window(pid, window)
        if not wid:
            raise RuntimeError(f"no X window named {window!r}")
        subprocess.run(["xdotool", "windowactivate", "--sync", wid], timeout=20, check=False)

    def key(self, pid, combo, window=None):
        wid = self._window(pid, window)
        if not wid:
            raise RuntimeError("no X window to type into")
        subprocess.run(["xdotool", "windowactivate", "--sync", wid], timeout=20, check=False)
        time.sleep(0.4)
        subprocess.run(["xdotool", "key", "--clearmodifiers", combo], timeout=20, check=True)

    def screenshot(self, path):
        subprocess.run(["import", "-window", "root", str(path)], timeout=30, check=False)


class WindowsUI(NativeUI):
    """pywinauto: the menu bar through Win32 (muda draws a real HMENU), the
    dialogs (TaskDialog) and the folder picker through UI Automation."""

    def _main(self, pid, window=None):
        from pywinauto import Desktop

        end = time.time() + 40
        while time.time() < end:
            for w in Desktop(backend="win32").windows(process=pid, visible_only=True):
                try:
                    if window and window not in w.window_text():
                        continue
                    menu = w.menu()
                    if menu is not None and menu.item_count() > 0:
                        return w
                except Exception:
                    continue
            time.sleep(0.5)
        raise RuntimeError("no window with a menu bar")

    @staticmethod
    def _clean(text: str) -> str:
        return text.split("\t", 1)[0].replace("&", "").strip()

    def menus(self, pid):
        w = self._main(pid)
        out = {}
        for item in w.menu().items():
            sub = item.sub_menu()
            entries = []
            if sub is not None:
                for s in sub.items():
                    entries.append({"name": self._clean(s.text()), "enabled": s.is_enabled()})
            out[self._clean(item.text())] = entries
        return out

    def click(self, pid, menu, item, window=None):
        w = self._main(pid, window)
        for top in w.menu().items():
            if self._clean(top.text()) != menu:
                continue
            for s in top.sub_menu().items():
                if self._clean(s.text()) == item:
                    if not s.is_enabled():
                        raise RuntimeError(f"{item!r} is disabled")
                    s.select()
                    return
        raise RuntimeError(f"no item {menu} > {item}")

    def dialog(self, pid, title, timeout=25, dismiss=True):
        from pywinauto import Desktop

        end = time.time() + timeout
        while time.time() < end:
            for w in Desktop(backend="uia").windows(process=pid):
                try:
                    if title not in w.window_text():
                        continue
                    texts = [t.window_text() for t in w.descendants(control_type="Text")]
                    if dismiss:
                        for b in w.descendants(control_type="Button"):
                            if b.window_text().replace("&", "") in ("OK", "Close"):
                                b.invoke()
                                break
                    return w.window_text() + "\n" + "\n".join(texts)
                except Exception:
                    continue
            time.sleep(0.5)
        raise RuntimeError(f"no dialog titled {title!r}")

    def pick_folder(self, pid, path):
        from pywinauto import Desktop

        end = time.time() + 30
        while time.time() < end:
            for w in Desktop(backend="uia").windows(process=pid):
                try:
                    edits = [e for e in w.descendants(control_type="Edit") if "Folder" in e.window_text() or "Folder" in (e.element_info.name or "")]
                    if not edits:
                        continue
                    edits[0].set_edit_text(path)
                    for b in w.descendants(control_type="Button"):
                        if b.window_text().replace("&", "") in ("Select Folder", "Open", "OK"):
                            b.invoke()
                            return
                except Exception:
                    continue
            time.sleep(0.5)
        raise RuntimeError("no folder picker appeared")

    def focus(self, pid, window):
        self._main(pid, window).set_focus()

    def key(self, pid, combo, window=None):
        from pywinauto.keyboard import send_keys

        self._main(pid, window).set_focus()
        time.sleep(0.4)
        send_keys({"ctrl+n": "^n", "F11": "{F11}"}.get(combo, combo))

    def screenshot(self, path):
        try:
            from PIL import ImageGrab

            ImageGrab.grab().save(path)
        except Exception:
            pass


class MacUI(NativeUI):
    """System Events (osascript). Needs the runner to grant accessibility
    to the process running it; a refusal is reported as BLOCKED."""

    def _osa(self, script: str, timeout: float = 60) -> str:
        res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            raise RuntimeError(f"osascript: {res.stderr.strip()[-600:]}")
        return res.stdout

    def _proc(self, pid):
        return f'(first process whose unix id is {pid})'

    @staticmethod
    def _top(menu: str) -> str:
        return "menu bar item 2" if menu == "igni" else f'menu bar item "{menu}"'

    def menus(self, pid):
        script = f"""
        tell application "System Events"
          set p to {self._proc(pid)}
          set out to ""
          repeat with mbi in menu bar items of menu bar 1 of p
            set out to out & "##" & (name of mbi as text) & linefeed
            try
              repeat with mi in menu items of menu 1 of mbi
                set n to name of mi
                if n is missing value then set n to "-"
                set out to out & (n as text) & "|" & (enabled of mi as text) & linefeed
              end repeat
            end try
          end repeat
          return out
        end tell"""
        out: dict[str, list[dict]] = {}
        current = None
        tops = 0
        for line in self._osa(script).splitlines():
            if line.startswith("##"):
                tops += 1
                # The app menu (the second item, after Apple's) is titled
                # by the bundle; the shell builds it as "igni".
                current = "igni" if tops == 2 else line[2:]
                out[current] = []
            elif current is not None and "|" in line:
                n, _, en = line.rpartition("|")
                out[current].append({"name": n, "enabled": en == "true"})
        return out

    def click(self, pid, menu, item, window=None):
        self._osa(
            f"""tell application "System Events"
              set p to {self._proc(pid)}
              set frontmost of p to true
              click menu item "{item}" of menu 1 of {self._top(menu)} of menu bar 1 of p
            end tell"""
        )

    def dialog(self, pid, title, timeout=25, dismiss=True):
        end = time.time() + timeout
        script = f"""
        tell application "System Events"
          set p to {self._proc(pid)}
          set out to ""
          repeat with w in windows of p
            set out to out & "##WINDOW " & (name of w as text) & linefeed
            try
              repeat with t in static texts of w
                set out to out & (value of t as text) & linefeed
              end repeat
            end try
          end repeat
          return out
        end tell"""
        while time.time() < end:
            text = self._osa(script)
            for block in text.split("##WINDOW ")[1:]:
                if title in block:
                    if dismiss:
                        try:
                            self._osa(
                                f"""tell application "System Events"
                                  set p to {self._proc(pid)}
                                  repeat with w in windows of p
                                    try
                                      click button "OK" of w
                                    end try
                                  end repeat
                                end tell"""
                            )
                        except RuntimeError:
                            pass
                    return block
            time.sleep(0.5)
        raise RuntimeError(f"no dialog showing {title!r}")

    def key(self, pid, combo, window=None):
        keyname = combo.split("+")[-1]
        self._osa(
            f"""tell application "System Events"
              set frontmost of {self._proc(pid)} to true
              keystroke "{keyname}" using command down
            end tell"""
        )

    def focus(self, pid, window):
        pass

    def screenshot(self, path):
        subprocess.run(["screencapture", "-x", str(path)], timeout=30, check=False)


# ─── one launch of the app ────────────────────────────────────────────


class Session:
    """One launch of the app: WebDriver when the platform has it, else a
    plain process. ``stop`` leaves no app, driver or backend behind."""

    def __init__(self, ctx: "Ctx", name: str, *, app: Path | None = None, args=(), env=None, webdriver=None):
        self.ctx = ctx
        self.name = name
        self.app = app or ctx.app
        self.args = [str(a) for a in args]
        self.env_extra = env or {}
        self.use_webdriver = ctx.webdriver if webdriver is None else webdriver
        self.dir = ctx.out / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.driver = None
        self.td = None
        self.proc = None
        self.app_pid: int | None = None
        self.t0 = 0.0

    def env(self) -> dict:
        env = self.ctx.base_env()
        for k, v in self.env_extra.items():
            if v is None:
                env.pop(k, None)
            else:
                env[k] = str(v)
        return env

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()

    def start(self):
        self.t0 = time.time()
        env = self.env()
        log = open(self.dir / "app.log", "w", encoding="utf-8", errors="replace")
        if self.use_webdriver:
            from selenium import webdriver
            from selenium.webdriver.common.options import ArgOptions

            env["TAURI_WEBVIEW_AUTOMATION"] = "true"
            cmd = [self.ctx.tauri_driver, "--port", "4444"]
            if IS_WIN:
                cmd += ["--native-driver", self.ctx.native_driver]
            self.td = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT)
            if not wait_for(lambda: socket.create_connection(("127.0.0.1", 4444), timeout=1).close() or True, 30):
                raise RuntimeError("tauri-driver did not listen on 4444")
            opts = ArgOptions()
            opts.set_capability("browserName", "wry")
            opts.set_capability("tauri:options", {"application": str(self.app), "args": self.args})
            self.driver = webdriver.Remote(command_executor="http://127.0.0.1:4444", options=opts)
            self.driver.set_script_timeout(60)
        else:
            self.proc = subprocess.Popen([str(self.app), *self.args], env=env, stdout=log, stderr=subprocess.STDOUT)
        procs = wait_for(lambda: app_processes(self.t0), 60)
        if not procs:
            raise RuntimeError("the app process never appeared")
        self.app_pid = min(procs, key=lambda p: p.create_time()).pid

    def stop(self):
        if self.driver is not None:
            done = threading.Event()

            def quit_driver():
                try:
                    self.driver.quit()
                except Exception:
                    pass
                done.set()

            threading.Thread(target=quit_driver, daemon=True).start()
            done.wait(20)
        for p in app_processes(self.t0):
            kill_tree(p.pid)
        if self.proc is not None:
            kill_tree(self.proc.pid)
        if self.td is not None:
            kill_tree(self.td.pid)
        # A backend whose app died exits on its parent-PID watchdog; do not
        # wait on it, take it down.
        for proc in psutil.process_iter(["create_time"]):
            try:
                if proc.info["create_time"] >= self.t0 - 1 and "igni_core.backend" in " ".join(cmdline(proc)):
                    if proc.pid not in self.ctx.keep_pids:
                        proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        time.sleep(1)

    # WebDriver helpers -------------------------------------------------

    def js(self, script: str, *args):
        return self.driver.execute_script(script, *args)

    def js_async(self, script: str, *args):
        return self.driver.execute_async_script(script, *args)

    def wait_js(self, script: str, timeout: float):
        return wait_for(lambda: self.js(script), timeout, 0.7)

    def connected(self, timeout: float = 180) -> bool:
        """The composer is ready. A bootstrap failure written over the
        loading view ends the wait at once (it is recorded in the log)."""
        if self.driver is not None:
            end = time.time() + timeout
            while time.time() < end:
                try:
                    if self.js(COMPOSER_READY_JS):
                        return True
                    err = self.loading_error()
                    if err:
                        (self.dir / "bootstrap-error.txt").write_text(err, encoding="utf-8")
                        return False
                except Exception:
                    pass
                time.sleep(1)
            return False
        # Without WebDriver: the backend has a client on its port.
        def has_client():
            leaf = backend_leaf(self.app_pid)
            return leaf and established_clients(leaf[0], leaf[1]) > 0

        return bool(wait_for(has_client, timeout, 1))

    def url(self) -> str:
        return self.driver.current_url if self.driver is not None else ""

    def session_id(self) -> str:
        return (self.js("const c = document.querySelector('.session-chip code'); return c ? c.innerText.trim() : '';") or "")

    def loading_error(self) -> str:
        return self.js("const e = document.querySelector('.igni-loading-error'); return e ? e.textContent : '';") or ""

    def hook_notify(self):
        self.js(
            "if (!window.__proofNotes) { window.__proofNotes = [];"
            " const h = window.__IGNI_HOST__ || (window.__IGNI_HOST__ = {});"
            " const orig = h.notify;"
            " h.notify = (p) => { window.__proofNotes.push({title: p && p.title, body: p && p.body});"
            "   try { return orig ? orig(p) : undefined; } catch (e) { return undefined; } }; }"
        )

    def notes(self) -> list[dict]:
        return self.js("return window.__proofNotes || [];") or []

    def send_chat(self, text: str):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.common.keys import Keys

        el = self.driver.find_element(By.CSS_SELECTOR, ".composer-editable")
        el.click()
        el.send_keys(text)
        el.send_keys(Keys.ENTER)

    def assistant_said(self, token: str, timeout: float = 60) -> bool:
        return bool(
            self.wait_js(
                "return [...document.querySelectorAll('.msg-assistant')].some(n => n.innerText.includes(arguments[0]));".replace(
                    "arguments[0]", json.dumps(token)
                ),
                timeout,
            )
        )

    def shot(self, label: str):
        if self.driver is not None:
            try:
                self.driver.save_screenshot(str(self.dir / f"{label}.png"))
            except Exception:
                pass

    def desktop_shot(self, label: str):
        self.ctx.ui.screenshot(self.dir / f"{label}-screen.png")

    def window_label(self) -> str:
        return self.js(
            "try { return window.__TAURI__.window.getCurrentWindow().label } catch (e) {"
            " return (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.metadata.currentWindow.label) || '' }"
        ) or ""

    def switch_to_label(self, label: str) -> bool:
        for handle in self.driver.window_handles:
            self.driver.switch_to.window(handle)
            if self.window_label() == label:
                return True
        return False


# ─── context ───────────────────────────────────────────────────────────


class Ctx:
    def __init__(self, a: argparse.Namespace):
        self.out = Path(a.out).resolve()
        self.platform = a.platform
        self.proof = Proof(self.out, a.platform)
        self.app = Path(a.app).resolve() if a.app else None
        self.core = Path(a.core).resolve()
        self.core_py = self.core / ".venv" / ("Scripts/python.exe" if IS_WIN else "bin/python")
        self.version = Path(a.version_file).read_text().strip()
        self.webdriver = bool(a.tauri_driver)
        self.tauri_driver = a.tauri_driver
        self.native_driver = a.native_driver
        self.keep_pids: set[int] = set()
        self.work = Path(a.work).resolve()
        self.work.mkdir(parents=True, exist_ok=True)
        self.home = Path.home()
        self.proj = (self.work / "igni-main-folder").resolve()
        self.proj2 = (self.work / "igni-second-folder").resolve()
        self.stub_port = free_port()
        self.probe_port = free_port()
        self.proxy_port = free_port()
        if IS_LINUX:
            self.ui: NativeUI = LinuxUI(Path(__file__).with_name("atspi_ui.py"))
        elif IS_WIN:
            self.ui = WindowsUI()
        else:
            self.ui = MacUI()

    def base_env(self) -> dict:
        env = {k: v for k, v in os.environ.items() if not k.startswith(("IGNI_", "IGNITE_"))}
        for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "NO_PROXY", "no_proxy", "VIRTUAL_ENV"):
            env.pop(k, None)
        return env

    @property
    def user_config(self) -> Path:
        return self.home / ".igni" / "config.yaml"

    @property
    def managed_settings(self) -> Path:
        if IS_MAC:
            return Path("/Library/Application Support/igni/managed-settings.yaml")
        if IS_LINUX:
            return Path("/etc/igni/managed-settings.yaml")
        return Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "igni" / "managed-settings.yaml"

    @property
    def cache_root(self) -> Path:
        if IS_MAC:
            return self.home / "Library" / "Caches" / "igni"
        if IS_WIN:
            return Path(os.environ["LOCALAPPDATA"]) / "igni"
        return Path(os.environ.get("XDG_CACHE_HOME") or self.home / ".cache") / "igni"

    def write_user_config(self, text: str | None):
        cfg = self.user_config
        cfg.parent.mkdir(parents=True, exist_ok=True)
        if text is None:
            if cfg.exists():
                cfg.unlink()
        else:
            cfg.write_text(text, encoding="utf-8")

    def write_managed(self, text: str | None):
        path = self.managed_settings
        if IS_WIN:
            path.parent.mkdir(parents=True, exist_ok=True)
            if text is None:
                if path.exists():
                    path.unlink()
            else:
                path.write_text(text, encoding="utf-8")
            return
        if text is None:
            subprocess.run(["sudo", "rm", "-f", str(path)], check=True)
            return
        subprocess.run(["sudo", "mkdir", "-p", str(path.parent)], check=True)
        subprocess.run(["sudo", "tee", str(path)], input=text, text=True, check=True, stdout=subprocess.DEVNULL)

    def prepare_projects(self):
        """Two trusted folders whose backend answers from the stub model and
        reads as signed in (as ``clients/web/e2e/fixtures/live-be.ts``)."""
        for folder in (self.proj, self.proj2):
            (folder / ".igni").mkdir(parents=True, exist_ok=True)
            (folder / "README.md").write_text("# desktop e2e proof\n", encoding="utf-8")
            (folder / "calc.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
            subprocess.run(["git", "init", "--quiet"], cwd=folder, check=False)
            creds = folder / ".igni" / "credentials.json"
            year = 365 * 24 * 3600
            creds.write_text(
                json.dumps(
                    {
                        "access_token": "e2e-fixture-token",
                        "token_type": "bearer",
                        "email": "fixture@example.com",
                        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + year)),
                    }
                ),
                encoding="utf-8",
            )
            (folder / ".igni" / "config.local.yaml").write_text(
                "\n".join(
                    [
                        "auth:",
                        f"  credentials_file: {json.dumps(str(creds))}",
                        "models:",
                        f"  default: {STUB_MODEL}",
                        "  registry:",
                        f"    {STUB_MODEL}:",
                        "      provider: openai_like",
                        f"      model_id: {STUB_MODEL}",
                        f"      url: http://127.0.0.1:{self.stub_port}/v1",
                        "      context_window: 8192",
                        "      vision: false",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            subprocess.run(
                [
                    str(self.core_py),
                    "-c",
                    "import sys; from igni_core.core.workspace_trust.service import WorkspaceTrust; WorkspaceTrust().trust(sys.argv[1])",
                    str(folder),
                ],
                check=True,
                env=self.base_env(),
            )


# ─── shared probes ─────────────────────────────────────────────────────


def diagnose(ctx: Ctx, s: Session) -> str:
    ctx.ui.click(s.app_pid, "File", "Diagnose Backend")
    text = ctx.ui.dialog(s.app_pid, DIAG_TITLE, timeout=60)
    (s.dir / "diagnose.txt").write_text(text, encoding="utf-8")
    return text


def diag_line(text: str, key: str) -> str:
    for line in text.splitlines():
        if line.strip().startswith(key):
            return line.split(":", 1)[1].strip() if ":" in line else ""
    return ""


def same_path(a: str, b: Path | str) -> bool:
    try:
        return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(str(b)))
    except Exception:
        return False


def guarded(ctx: Ctx, row: str, what: str, fn) -> None:
    """Run one scenario; a crash is a FAIL that names the scenario."""
    try:
        fn()
    except Exception as exc:
        tb = traceback.format_exc()
        (ctx.out / f"crash-{what}.txt").write_text(tb, encoding="utf-8")
        message = f"{type(exc).__name__}: {exc}"
        if IS_MAC and ("assistive access" in message or "-1719" in message or "-25211" in message):
            # The runner did not grant System Events control of the UI.
            ctx.proof.blocked(row, f"{what} ran to the end", "macOS refused accessibility to the runner: " + message[:400])
        else:
            ctx.proof.check(row, f"{what} ran to the end", False, message[:600])


# ─── R617: the developer override ─────────────────────────────────────


def r617_unacknowledged(ctx: Ctx):
    """IGNI_DEV_BACKEND without IGNITE_EMBER_DEV (and with an ack word that
    is not 1/true) is ignored. Air-gapped, so the managed runtime the app
    falls through to is refused at once instead of downloaded."""
    for ack in (None, "yes"):
        label = "unset" if ack is None else ack
        env = {"IGNI_DEV_BACKEND": ctx.core_py, "IGNITE_EMBER_DEV": ack, "IGNI_AIR_GAPPED": "1"}
        managed_py = ctx.cache_root / "venv" / ("Scripts/python.exe" if IS_WIN else "bin/python")
        managed_present = managed_py.exists()
        with Session(ctx, f"r617-ack-{label}", args=[ctx.proj], env=env) as s:
            if managed_present:
                # A managed runtime is already installed (Windows installs the
                # MSI first), so falling through to it starts a backend: it
                # must be the managed one, never the override.
                s.connected(240)
                tree = backend_tree(s.app_pid)
                argv0 = cmdline(tree[0])[0] if tree else ""
                ctx.proof.check(
                    "R617",
                    f"IGNITE_EMBER_DEV={label}: the override is ignored; the backend runs from the managed venv",
                    same_path(argv0, managed_py) and not same_path(argv0, ctx.core_py),
                    f"argv0={argv0}",
                )
            else:
                if s.driver is not None:
                    err = s.wait_js("const e = document.querySelector('.igni-loading-error'); return e ? e.textContent : '';", 120) or ""
                    s.shot("refused")
                    ctx.proof.check(
                        "R617",
                        f"IGNITE_EMBER_DEV={label}: the override is ignored and the app falls through to the managed runtime (refused: air-gapped)",
                        "air-gapped" in err and "will not download" in err,
                        err[:300],
                    )
                else:
                    time.sleep(20)
                ctx.proof.check(
                    "R617",
                    f"IGNITE_EMBER_DEV={label}: no backend was started from the override interpreter",
                    not backend_tree(s.app_pid),
                    f"backend processes under the app: {[cmdline(p)[:1] for p in backend_tree(s.app_pid)]}",
                )
            text = diagnose(ctx, s)
            ctx.proof.check("R617", f"IGNITE_EMBER_DEV={label}: Diagnose names the managed venv, not the override", diag_line(text, "Backend source") == "managed venv", diag_line(text, "Backend source"))
            ctx.proof.check("R617", f"IGNITE_EMBER_DEV={label}: Diagnose shows the override variable and says it is ignored", same_path(diag_line(text, "IGNI_DEV_BACKEND"), ctx.core_py) and "override env var set without ack — ignored" in text, text[-500:])
            log = (s.dir / "app.log").read_text(errors="replace")
            if "detected but IGNITE_EMBER_DEV is unset" in log:
                ctx.proof.info("R617", f"IGNITE_EMBER_DEV={label}: the shell's stderr notice", "IGNI_DEV_BACKEND=… detected but IGNITE_EMBER_DEV is unset — ignoring override")


def r617_acknowledged(ctx: Ctx):
    """IGNI_PYTHON alone with IGNITE_EMBER_DEV=TRUE (case-insensitive) is
    honoured; the big override session checks IGNI_DEV_BACKEND's
    precedence over IGNI_PYTHON."""
    env = {"IGNI_PYTHON": ctx.core_py, "IGNITE_EMBER_DEV": "TRUE"}
    with Session(ctx, "r617-igni-python", args=[ctx.proj], env=env) as s:
        ok = s.connected(180)
        leaf = backend_leaf(s.app_pid)
        argv0 = cmdline(leaf[0])[0] if leaf else ""
        tree = backend_tree(s.app_pid)
        argv0 = cmdline(tree[0])[0] if tree else argv0
        ctx.proof.check("R617", "IGNI_PYTHON with IGNITE_EMBER_DEV=TRUE starts the backend from that interpreter", ok and same_path(argv0, ctx.core_py), f"connected={ok} argv0={argv0}")


# ─── the main override session: R617 R620 R622 R632 R624 (menus) ──────


CSP_PROBE = r"""
const done = arguments[arguments.length - 1];
const probePort = arguments[0];
const out = { violations: [] };
document.addEventListener('securitypolicyviolation', (e) => out.violations.push({
  directive: e.violatedDirective, effective: e.effectiveDirective, blocked: e.blockedURI, policy: e.originalPolicy }));
window.__cspInline = 'not run';
const s = document.createElement('script');
s.textContent = "window.__cspInline = 'ran'";
document.head.appendChild(s);
try { out.evalResult = String(eval('40 + 2')); } catch (err) { out.evalError = err.name + ': ' + err.message; }
try { out.functionResult = String(new Function('return 7')()); } catch (err) { out.functionError = err.name + ': ' + err.message; }
const ext = document.createElement('script');
ext.src = 'http://127.0.0.1:' + probePort + '/probe.js';
ext.onload = () => { out.externalLoaded = true; };
ext.onerror = () => { out.externalError = true; };
document.head.appendChild(ext);
const img = new Image();
img.onload = () => { out.imageLoaded = true; };
img.onerror = () => { out.imageError = true; };
img.src = 'https://example.com/igni-csp-probe.png';
fetch('https://example.com/').then(() => { out.fetchOk = true; }, (e) => { out.fetchError = String(e); });
const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
out.meta = meta ? meta.content : null;
setTimeout(() => { out.inline = window.__cspInline; out.external = window.__cspExternal || 'not run'; done(out); }, 4000);
"""

CAPABILITY_PROBE = r"""
const done = arguments[arguments.length - 1];
const outside = arguments[0];
const inv = window.__TAURI__.core.invoke;
const out = {};
const calls = [
  ['updater', 'plugin:updater|check', {}],
  ['dialogMessage', 'plugin:dialog|message', { message: 'csp probe', title: 'probe' }],
  ['openOutsideHome', 'plugin:opener|open_path', { path: outside }],
  ['shell', 'plugin:shell|execute', { program: 'sh', args: [] }],
  ['fsRead', 'plugin:fs|read_text_file', { path: outside }],
  ['checkUpdateCommand', 'igni_check_update', {}],
  ['isFullscreen', 'plugin:window|is_fullscreen', { label: 'main' }],
];
(async () => {
  for (const [k, cmd, args] of calls) {
    try { out[k] = { ok: true, value: JSON.stringify(await inv(cmd, args)) }; }
    catch (e) { out[k] = { ok: false, error: String(e) }; }
  }
  done(out);
})();
"""

WS_PAGE_PROBE = r"""
const done = arguments[arguments.length - 1];
const ws = new URL(location.href).searchParams.get('ws');
let opened = false; let finished = false;
const finish = (why) => { if (!finished) { finished = true; done({ opened, why }); } };
try {
  const sock = new WebSocket(ws, ['igni.v1']);
  sock.onopen = () => { opened = true; sock.close(); };
  sock.onclose = (e) => finish('close ' + e.code);
  sock.onerror = () => {};
} catch (e) { finish('throw ' + e); }
setTimeout(() => finish('timeout'), 8000);
"""


def r622_checks(ctx: Ctx, s: Session):
    leaf = backend_leaf(s.app_pid)
    if not leaf:
        ctx.proof.check("R622", "a backend is listening", False, "no listening backend under the app")
        return
    proc, port = leaf
    token = ""
    if s.driver is not None:
        frag = urllib.parse.urlsplit(s.url()).fragment
        token = urllib.parse.parse_qs(frag).get("igni_ws_token", [""])[0]
        ctx.proof.check("R622", "the window was handed a per-launch token in its URL fragment", bool(token), fingerprint(token) if token else "none")
    try:
        environ = proc.environ()
    except psutil.AccessDenied:
        environ = {}
    fd = environ.get("IGNI_WS_TOKEN_FD")
    ctx.proof.check("R622", "the backend got its token on a pipe (IGNI_WS_TOKEN_FD=0), not in its environment", fd == "0" and "IGNI_WS_TOKEN" not in environ, f"IGNI_WS_TOKEN_FD={fd!r} IGNI_WS_TOKEN present={'IGNI_WS_TOKEN' in environ}")
    if token:
        leaked = [k for k, v in environ.items() if token in v]
        ctx.proof.check("R622", "the token value appears nowhere in the backend's environment", not leaked, f"variables holding it: {leaked}")
        argv = " ".join(cmdline(proc))
        ctx.proof.check("R622", "the token value is not on the backend's command line", token not in argv, "")
    cases = [
        ("no subprotocol, no Origin (a local process)", None, None, 403),
        ("igni.v1 only, a loopback page's Origin", ["igni.v1"], "http://127.0.0.1:8765", 403),
        ("a wrong token, the app's own Origin", ["igni.v1", "igni-token.wrong-token-value"], TAURI_ORIGIN, 403),
    ]
    if token:
        cases += [
            ("the right token from a foreign page's Origin", ["igni.v1", f"igni-token.{token}"], "https://evil.example", 403),
            ("the right token from the app's Origin", ["igni.v1", f"igni-token.{token}"], TAURI_ORIGIN, 101),
        ]
    for label, protocols, origin, want in cases:
        status, selected = ws_handshake(port, protocols, origin)
        detail = f"status={status}" + (f" selected={selected!r}" if want == 101 else "")
        ok = status == want and (want != 101 or (selected == "igni.v1" and token not in selected))
        ctx.proof.check("R622", f"handshake, {label}: {want}", ok, detail)
    if s.driver is not None:
        res = s.js_async(WS_PAGE_PROBE) or {}
        ctx.proof.check("R622", "a page in the real webview opening the backend's socket without the token is refused", res.get("opened") is False, json.dumps(res))
        ctx.proof.check("R622", "the window itself, holding the token, is connected", bool(s.js(COMPOSER_READY_JS)), "")


def r632_checks(ctx: Ctx, s: Session):
    if s.driver is None:
        ctx.proof.blocked("R632", "CSP probes in the webview", "no WebDriver for WKWebView on macOS; Linux and Windows carry this row")
        return
    ProbeFiles.hits.clear()
    res = s.js_async(CSP_PROBE, ctx.probe_port) or {}
    (s.dir / "csp-probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    directives = {v.get("effective") or v.get("directive") for v in res.get("violations", [])}
    ctx.proof.check("R632", "an inline <script> does not run", res.get("inline") == "not run", f"inline={res.get('inline')}")
    ctx.proof.check("R632", "eval() is refused", "evalError" in res, res.get("evalError") or f"eval returned {res.get('evalResult')}")
    ctx.proof.check("R632", "new Function() is refused", "functionError" in res, res.get("functionError") or f"returned {res.get('functionResult')}")
    ctx.proof.check("R632", "a script from another origin (a loopback server) neither loads nor is requested", res.get("external") == "not run" and not res.get("externalLoaded") and not ProbeFiles.hits, f"external={res.get('external')} hits={ProbeFiles.hits}")
    ctx.proof.check("R632", "an image from a remote host is blocked", not res.get("imageLoaded"), f"imageError={res.get('imageError')}")
    ctx.proof.check("R632", "fetch() to a remote host is blocked", not res.get("fetchOk"), res.get("fetchError") or "")
    ctx.proof.check("R632", "the browser reported script-src violations", any(d and d.startswith("script-src") for d in directives), f"directives={sorted(d for d in directives if d)}")
    policies = {v.get("policy") for v in res.get("violations", []) if v.get("policy")}
    if policies:
        ctx.proof.info("R632", "the policy the webview enforced", " | ".join(sorted(policies))[:900])
    outside = r"C:\Windows\win.ini" if IS_WIN else "/etc/hosts"
    cap = s.js_async(CAPABILITY_PROBE, outside) or {}
    (s.dir / "capability-probe.json").write_text(json.dumps(cap, indent=2), encoding="utf-8")

    def refused(k):
        v = cap.get(k) or {}
        return v.get("ok") is False

    ctx.proof.check("R632", "the window may not call the updater plugin directly", refused("updater"), json.dumps(cap.get("updater")))
    ctx.proof.check("R632", "the window may not raise a message dialog (only dialog:allow-open is granted)", refused("dialogMessage"), json.dumps(cap.get("dialogMessage")))
    ctx.proof.check("R632", "opener refuses a path outside $HOME", refused("openOutsideHome"), json.dumps(cap.get("openOutsideHome")))
    ctx.proof.check("R632", "no shell plugin is reachable", refused("shell"), json.dumps(cap.get("shell")))
    ctx.proof.check("R632", "no fs plugin is reachable", refused("fsRead"), json.dumps(cap.get("fsRead")))
    ctx.proof.check("R632", "a granted call still works (igni_check_update, window:is_fullscreen)", (cap.get("checkUpdateCommand") or {}).get("ok") is not None and (cap.get("isFullscreen") or {}).get("ok") is True, json.dumps({k: cap.get(k) for k in ("checkUpdateCommand", "isFullscreen")}))


EXPECTED_FILE_MENU = ["New Chat", "New Window…", "Restart Backend", "Reinstall Backend (Clean)", "Diagnose Backend"]


def r624_menu_structure(ctx: Ctx, s: Session):
    menus = ctx.ui.menus(s.app_pid)
    (s.dir / "menus.json").write_text(json.dumps(menus, indent=2), encoding="utf-8")
    names = {k: [i["name"] for i in v] for k, v in menus.items()}
    ctx.proof.info("R624", "the menu bar as the accessibility API sees it", json.dumps(names)[:900])
    file_items = names.get("File", [])
    ctx.proof.check("R624", "File holds New Chat, New Window…, Restart/Reinstall/Diagnose Backend", all(i in file_items for i in EXPECTED_FILE_MENU), json.dumps(file_items))
    app_items = names.get("igni", [])
    ctx.proof.check("R624", "the igni menu holds Check for Updates…", "Check for Updates…" in app_items, json.dumps(app_items))
    view_items = names.get("View", [])
    ctx.proof.check("R624", "a release build's View menu offers no Toggle Developer Tools", "Toggle Developer Tools" not in view_items and bool(view_items), json.dumps(view_items))
    if not IS_MAC:
        quit_item = next((i for i in menus.get("igni", []) if i["name"] == "Quit igni"), None)
        fs_item = next((i for i in menus.get("View", []) if i["name"] == "Toggle Full Screen"), None)
        ctx.proof.check("R624", "off macOS, Quit igni and Toggle Full Screen are there and enabled", bool(quit_item and quit_item["enabled"] and fs_item and fs_item["enabled"]), json.dumps([quit_item, fs_item]))
        own = ("igni", "File", "View")
        disabled = [f"{m} > {i['name']}" for m, items in menus.items() if m in own for i in items if i["name"] and not i["enabled"]]
        ctx.proof.check("R624", "off macOS, nothing in the igni, File or View menus is drawn disabled", not disabled, json.dumps(disabled))
        others = [f"{m} > {i['name']}" for m, items in menus.items() if m not in own for i in items if i["name"] and not i["enabled"]]
        if others:
            ctx.proof.info("R624", "disabled items in the Edit and Window menus (the OS's predefined ones)", json.dumps(others))


def override_session(ctx: Ctx):
    env = {"IGNI_DEV_BACKEND": ctx.core_py, "IGNI_PYTHON": str(ctx.work / "no-such-python"), "IGNITE_EMBER_DEV": "1"}
    with Session(ctx, "override", args=[ctx.proj], env=env) as s:
        ok = s.connected(240)
        s.shot("connected")
        tree = backend_tree(s.app_pid)
        argv0 = cmdline(tree[0])[0] if tree else ""
        ctx.proof.check("R617", "IGNI_DEV_BACKEND + IGNITE_EMBER_DEV=1 starts the backend from the override, over IGNI_PYTHON", ok and same_path(argv0, ctx.core_py), f"connected={ok} argv0={argv0}")
        if s.driver is not None:
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(s.url()).query)
            ctx.proof.check("R617", "the window is told backend_source=dev_override", q.get("backend_source") == ["dev_override"], f"backend_source={q.get('backend_source')} actual_cli={q.get('actual_cli')}")
        text = diagnose(ctx, s)
        ctx.proof.check("R620", "Diagnose (dev override): Backend source is 'dev override'", diag_line(text, "Backend source") == "dev override", diag_line(text, "Backend source"))
        ctx.proof.check("R620", "Diagnose (dev override): the interpreter path is the override", same_path(diag_line(text, "Interpreter path"), ctx.core_py), diag_line(text, "Interpreter path"))
        ctx.proof.check("R620", "Diagnose: App version and Actual ignite-ember versions shown and matching", diag_line(text, "App version") == ctx.version and diag_line(text, "Actual ignite-ember") == ctx.version, f"app={diag_line(text, 'App version')} actual={diag_line(text, 'Actual ignite-ember')}")
        ctx.proof.check("R620", "Diagnose: the override variables and the acknowledgement are listed", same_path(diag_line(text, "IGNI_DEV_BACKEND"), ctx.core_py) and diag_line(text, "IGNITE_EMBER_DEV") == "1", "")
        ctx.proof.check("R620", "Diagnose: the install marker's path and contents are listed", bool(diag_line(text, "Marker file")) and bool(diag_line(text, "Marker contents")), f"{diag_line(text, 'Marker file')} :: {diag_line(text, 'Marker contents')[:120]}")
        guarded(ctx, "R622", "R622 token checks", lambda: r622_checks(ctx, s))
        guarded(ctx, "R632", "R632 CSP and capability probes", lambda: r632_checks(ctx, s))
        guarded(ctx, "R624", "R624 menu structure", lambda: r624_menu_structure(ctx, s))


# ─── R624 actions and R619 restart / crash ─────────────────────────────


def marker_token() -> str:
    return "TKN" + base64.b32encode(os.urandom(5)).decode().rstrip("=")


def menus_and_restart_session(ctx: Ctx):
    env = {"IGNI_DEV_BACKEND": ctx.core_py, "IGNITE_EMBER_DEV": "1"}
    with Session(ctx, "menus-and-restart", args=[ctx.proj], env=env) as s:
        if not s.connected(240):
            ctx.proof.check("R624", "the window connects", False, "composer never became ready")
            return
        pid = s.app_pid
        web = s.driver is not None
        main_handle = second_handle = None
        ok2 = False
        if web:
            s.hook_notify()
            token = marker_token()
            s.send_chat(f"Remember the codeword {token}. Reply with exactly {token}.")
            ctx.proof.check("R619", "the window chats (stub model answers through the real backend)", s.assistant_said(token, 90), "")
            s.shot("chatted")
            sid0 = s.session_id()
            ctx.ui.click(pid, "File", "New Chat")
            sid1 = wait_for(lambda: (lambda v: v if v and v != sid0 else None)(s.session_id()), 30)
            empty = s.wait_js("return document.querySelectorAll('.msg-assistant').length === 0;", 20)
            ctx.proof.check("R624", "File > New Chat starts a new session (new id, empty transcript)", bool(sid1) and bool(empty), f"{sid0} -> {sid1}")
            try:
                ctx.ui.key(pid, "ctrl+n" if not IS_MAC else "cmd+n", window=ctx.proj.name)
                sid2 = wait_for(lambda: (lambda v: v if v and v != sid1 else None)(s.session_id()), 30)
                ctx.proof.check("R624", "the New Chat accelerator (Ctrl/Cmd+N) does the same", bool(sid2), f"{sid1} -> {sid2}")
            except Exception as exc:
                ctx.proof.check("R624", "the New Chat accelerator (Ctrl/Cmd+N) does the same", False, str(exc)[:300])
            before = len(s.notes())
            ctx.ui.click(pid, "igni", "Check for Updates…")
            notes = wait_for(lambda: (lambda n: n if len(n) > before else None)(s.notes()), 60) or []
            ctx.proof.check("R624", "igni > Check for Updates… reaches the web UI and is answered", len(notes) > before, json.dumps(notes[before:])[:300])
            # New Window on a second folder.
            ctx.ui.click(pid, "File", "New Window…")
            ctx.ui.pick_folder(pid, str(ctx.proj2))
            two = wait_for(lambda: len(s.driver.window_handles) >= 2, 40)
            for h in s.driver.window_handles:
                s.driver.switch_to.window(h)
                if s.window_label() == "main":
                    main_handle = h
                else:
                    second_handle = h
            if two and second_handle:
                s.driver.switch_to.window(second_handle)
                ok2 = s.connected(120)
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(s.url()).query)
                ctx.proof.check("R624", "File > New Window… opens a second window on the chosen folder, connected", ok2 and same_path((q.get("dir") or [""])[0], ctx.proj2), f"dir={q.get('dir')}")
                s.shot("second-window")
            else:
                ctx.proof.check("R624", "File > New Window… opens a second window on the chosen folder, connected", False, f"handles={len(s.driver.window_handles)}")
            if ok2:
                s.hook_notify()
                s.driver.switch_to.window(main_handle)
                main_sid = s.session_id()
                s.driver.switch_to.window(second_handle)
                second_sid = s.session_id()
                title2 = ctx.proj2.name
                ctx.ui.focus(pid, title2)
                time.sleep(1)
                ctx.ui.click(pid, "File", "New Chat", window=title2)
                second_new = wait_for(lambda: (lambda v: v if v and v != second_sid else None)(s.session_id()), 30)
                s.driver.switch_to.window(main_handle)
                main_after = s.session_id()
                ctx.proof.check("R624", "New Chat in the second window changes only that window", bool(second_new) and main_after == main_sid, f"second {second_sid}->{second_new}; main {main_sid}->{main_after}")
                counts = {}
                for h in (main_handle, second_handle):
                    s.driver.switch_to.window(h)
                    counts[h] = len(s.notes())
                ctx.ui.click(pid, "igni", "Check for Updates…", window=title2)
                time.sleep(15)
                delta = 0
                for h in (main_handle, second_handle):
                    s.driver.switch_to.window(h)
                    delta += len(s.notes()) - counts[h]
                ctx.proof.check("R624", "Check for Updates with two windows open checks once and notifies once", delta == 1, f"notifications across both windows: {delta}")
                s.driver.switch_to.window(main_handle)
            # Toggle Full Screen (off macOS the shell's own item).
            if not IS_MAC:
                ctx.ui.focus(pid, ctx.proj.name)
                time.sleep(1)
                ctx.ui.click(pid, "View", "Toggle Full Screen", window=ctx.proj.name)
                fs = wait_for(lambda: s.js_async("const d = arguments[arguments.length-1]; window.__TAURI__.window.getCurrentWindow().isFullscreen().then(d, () => d(null));") is True, 15)
                ctx.proof.check("R624", "View > Toggle Full Screen puts the window in fullscreen", bool(fs), "")
                ctx.ui.click(pid, "View", "Toggle Full Screen", window=ctx.proj.name)
                left = wait_for(lambda: s.js_async("const d = arguments[arguments.length-1]; window.__TAURI__.window.getCurrentWindow().isFullscreen().then(d, () => d(null));") is False, 15)
                ctx.proof.check("R624", "View > Toggle Full Screen again leaves fullscreen", bool(left), "")
        # R619: restart from the menu.
        leaf = backend_leaf(pid)
        if not leaf:
            ctx.proof.check("R619", "a backend is running before the restart", False, "")
            return
        p1 = leaf[0].pid
        port1 = leaf[1]
        ctx.ui.click(pid, "File", "Restart Backend")
        new_leaf = wait_for(lambda: (lambda l: l if l and l[0].pid != p1 else None)(backend_leaf(pid)), 120)
        ctx.proof.check("R619", "File > Restart Backend starts a new backend process and the old one is gone", bool(new_leaf) and not alive(p1), f"old pid {p1} alive={alive(p1)}; new={new_leaf[0].pid if new_leaf else None}")
        if web:
            if main_handle:
                s.driver.switch_to.window(main_handle)
            back = s.connected(180)
            ctx.proof.check("R619", "the window comes back connected to the new backend", back and str(new_leaf[1] if new_leaf else "") in urllib.parse.unquote(s.url()), f"port {port1} -> {new_leaf[1] if new_leaf else None}")
            token = marker_token()
            s.send_chat(f"Reply with exactly {token}.")
            ctx.proof.check("R619", "after the restart the window chats again", s.assistant_said(token, 90), "")
            s.shot("after-restart")
            if second_handle and ok2:
                s.driver.switch_to.window(second_handle)
                ok_second = s.connected(120)
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(s.url()).query)
                ctx.proof.check("R619", "the second window comes back on its own folder and the new port", ok_second and same_path((q.get("dir") or [""])[0], ctx.proj2) and str(new_leaf[1]) in urllib.parse.unquote(s.url()), f"dir={q.get('dir')}")
                s.driver.switch_to.window(main_handle)
        else:
            ctx.proof.check("R619", "the window reconnects to the new backend", s.connected(180), "")
        # R619: a backend that crashes on its own.
        leaf = backend_leaf(pid)
        if leaf:
            p2 = leaf[0].pid
            leaf[0].kill()
            respawned = wait_for(lambda: (lambda l: l if l and l[0].pid != p2 else None)(backend_leaf(pid)), 60, 1)
            ctx.proof.check("R619", "a backend killed from outside (crash) is respawned by the app on its own", bool(respawned), f"killed pid {p2}; new backend: {respawned[0].pid if respawned else None}")
            if web:
                state = s.js("const e = document.querySelector('.composer-editable'); return e ? (e.dataset.placeholder || '') : document.title;")
                ctx.proof.info("R619", "what the window shows after the crash", str(state)[:200])
                s.shot("after-crash")
                if respawned:
                    ctx.proof.check("R619", "after the crash the window is connected again", s.connected(180), "")
                    tok = marker_token()
                    s.send_chat(f"Reply with exactly {tok}.")
                    ctx.proof.check("R619", "after the crash the window chats again", s.assistant_said(tok, 90), "")
            if not respawned:
                ctx.ui.click(pid, "File", "Restart Backend")
                rec = wait_for(lambda: backend_leaf(pid), 120)
                ctx.proof.check("R619", "after a crash, File > Restart Backend brings a backend back", bool(rec), "")
        # Quit from the menu (off macOS the shell's own item).
        if not IS_MAC:
            leaf = backend_leaf(pid)
            bpid = leaf[0].pid if leaf else None
            ctx.ui.click(pid, "igni", "Quit igni")
            gone = wait_for(lambda: not alive(pid), 30)
            bgone = wait_for(lambda: bpid is None or not alive(bpid), 30)
            ctx.proof.check("R624", "igni > Quit igni ends the app and its backend", bool(gone) and bool(bgone), f"app alive={alive(pid)} backend alive={alive(bpid) if bpid else None}")


# ─── R618 / R619 / R620 against a backend another client started ───────


def start_hand_backend(ctx: Ctx, log: Path) -> tuple[subprocess.Popen, int]:
    proc = subprocess.Popen(
        [str(ctx.core_py), "-m", "igni_core.backend", "--ws-port", "0", "--project-dir", str(ctx.proj)],
        env=ctx.base_env(),
        stdout=subprocess.PIPE,
        stderr=open(log, "w", encoding="utf-8", errors="replace"),
        text=True,
    )
    end = time.time() + 120
    while time.time() < end:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                raise RuntimeError("the hand-started backend exited before ready")
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("status") == "ready":
            threading.Thread(target=lambda: [None for _ in proc.stdout], daemon=True).start()
            port = int(str(msg.get("ws_url", "")).rsplit(":", 1)[-1].strip("/"))
            return proc, port
    raise RuntimeError("no ready line from the hand-started backend")


def attached_session(ctx: Ctx):
    hand, port = start_hand_backend(ctx, ctx.out / "hand-backend.stderr.log")
    ctx.keep_pids.add(hand.pid)
    for child in psutil.Process(hand.pid).children(recursive=True):
        ctx.keep_pids.add(child.pid)
    try:
        with Session(ctx, "attached", args=[ctx.proj], env={"IGNI_AIR_GAPPED": "1"}) as s:
            connected = s.connected(120)
            if s.driver is not None:
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(s.url()).query)
                ctx.proof.check("R618", "the app attaches to the backend another client started (backend_source=discovered)", q.get("backend_source") == ["discovered"] and connected, f"backend_source={q.get('backend_source')} connected={connected}")
            ctx.proof.check("R618", "the app spawned no backend of its own", not backend_tree(s.app_pid), "")
            ctx.ui.click(s.app_pid, "File", "Reinstall Backend (Clean)")
            text = ctx.ui.dialog(s.app_pid, "Reinstall Backend", timeout=30)
            (s.dir / "reinstall-refusal.txt").write_text(text, encoding="utf-8")
            ctx.proof.check("R618", "Reinstall on an attached backend is refused in a native dialog that says why", ATTACHED_PREFIX in text and ATTACHED_REINSTALL in text, text[:300])
            ctx.proof.check("R618", "the other client's backend is untouched", hand.poll() is None, "")
            ctx.ui.click(s.app_pid, "File", "Restart Backend")
            text = ctx.ui.dialog(s.app_pid, "Restart Backend", timeout=30)
            (s.dir / "restart-refusal.txt").write_text(text, encoding="utf-8")
            ctx.proof.check("R619", "Restart on an attached backend is refused in a native dialog that says why", ATTACHED_PREFIX in text and ATTACHED_RESTART in text, text[:300])
            ctx.proof.check("R619", "the other client's backend is untouched by the refused restart", hand.poll() is None, "")
            text = diagnose(ctx, s)
            ctx.proof.check("R620", "Diagnose (attached): source says attached to another client's backend", diag_line(text, "Backend source") == "attached to a backend another igni client started", diag_line(text, "Backend source"))
            ctx.proof.check("R620", "Diagnose (attached): Actual ignite-ember is that backend's version", diag_line(text, "Actual ignite-ember") == ctx.version, diag_line(text, "Actual ignite-ember"))
    finally:
        kill_tree(hand.pid)
        ctx.keep_pids.clear()


# ─── R620: a provisioned interpreter ──────────────────────────────────


def provisioned_session(ctx: Ctx):
    ctx.write_user_config(f"runtime_python: {ctx.core_py}\n")
    try:
        with Session(ctx, "provisioned-setting", args=[ctx.proj], env={"IGNI_AIR_GAPPED": "1"}) as s:
            ok = s.connected(240)
            tree = backend_tree(s.app_pid)
            argv0 = cmdline(tree[0])[0] if tree else ""
            ctx.proof.check("R620", "runtime_python in ~/.igni/config.yaml runs the backend from that interpreter", ok and same_path(argv0, ctx.core_py), f"argv0={argv0}")
            text = diagnose(ctx, s)
            ctx.proof.check("R620", "Diagnose (provisioned): source, interpreter and the runtime_python line", diag_line(text, "Backend source") == "provisioned (runtime_python)" and same_path(diag_line(text, "Interpreter path"), ctx.core_py) and same_path(diag_line(text, "runtime_python setting"), ctx.core_py) and diag_line(text, "IGNI_RUNTIME_PYTHON") == "<unset>", text[:600])
            ctx.proof.check("R620", "Diagnose (provisioned): Actual ignite-ember is that interpreter's igni-core", diag_line(text, "Actual ignite-ember") == ctx.version, diag_line(text, "Actual ignite-ember"))
    finally:
        ctx.write_user_config(None)
    with Session(ctx, "provisioned-env", args=[ctx.proj], env={"IGNI_AIR_GAPPED": "1", "IGNI_RUNTIME_PYTHON": ctx.core_py}) as s:
        s.connected(240)
        text = diagnose(ctx, s)
        ctx.proof.check("R620", "Diagnose (IGNI_RUNTIME_PYTHON): the variable is listed and the source is provisioned", same_path(diag_line(text, "IGNI_RUNTIME_PYTHON"), ctx.core_py) and diag_line(text, "Backend source") == "provisioned (runtime_python)", text[:600])


# ─── R628: the update policy ──────────────────────────────────────────


def r628_session(ctx: Ctx, proxy: ConnectProxy):
    proxy_env = {
        "HTTPS_PROXY": f"http://127.0.0.1:{ctx.proxy_port}",
        "HTTP_PROXY": f"http://127.0.0.1:{ctx.proxy_port}",
        "https_proxy": f"http://127.0.0.1:{ctx.proxy_port}",
        "http_proxy": f"http://127.0.0.1:{ctx.proxy_port}",
        "NO_PROXY": "127.0.0.1,localhost,::1",
        "no_proxy": "127.0.0.1,localhost,::1",
        "IGNI_DEV_BACKEND": ctx.core_py,
        "IGNITE_EMBER_DEV": "1",
    }
    mirror = "https://mirror.igni.test/latest.json"
    cases = [
        ("no-policy", None, None, {}, "compiled"),
        ("user-ttl-0", "update_check_ttl: 0\n", None, {}, "off"),
        ("managed-ttl-0-over-user", "update_check_ttl: 86400\n", "update_check_ttl: 0\n", {}, "off"),
        ("env-air-gapped", None, None, {"IGNI_AIR_GAPPED": "1"}, "off"),
        ("managed-air-gapped", None, "air_gapped: true\n", {}, "off"),
        ("managed-mirror-over-user", "update_endpoint: https://user-mirror.igni.test/latest.json\n", f"update_endpoint: {mirror}\n", {}, "mirror"),
    ]
    control_seen = None
    for name, user, managed, extra, expect in cases:
        ctx.write_user_config(user)
        ctx.write_managed(managed)
        try:
            mark = proxy.mark()
            with Session(ctx, f"r628-{name}", args=[ctx.proj], env={**proxy_env, **extra}) as s:
                ok = s.connected(240)
                time.sleep(8)  # the startup check, when the policy allows one
                notes = []
                result = None
                if s.driver is not None:
                    s.hook_notify()
                    ctx.ui.click(s.app_pid, "igni", "Check for Updates…")
                    notes = wait_for(lambda: s.notes(), 60) or []
                    result = s.js_async("const d = arguments[arguments.length-1]; window.__TAURI__.core.invoke('igni_check_update').then(v => d({ok: true, v}), e => d({ok: false, e: String(e)}));")
                else:
                    ctx.ui.click(s.app_pid, "igni", "Check for Updates…")
                    time.sleep(15)
                app_pids = {p.pid for p in app_processes(s.t0)}
                seen = proxy.since(mark)
            by_app = [e for e in seen if e["pid"] in app_pids or (e["process"] or "").lower() in APP_NAMES]
            (ctx.out / f"r628-{name}" / "proxy.json").write_text(json.dumps(seen, indent=2), encoding="utf-8")
            hosts = sorted({e["host"] for e in by_app})
            detail = f"connected={ok} app asked={hosts} notes={json.dumps(notes)[:200]} invoke={json.dumps(result)[:200]}"
            if expect == "compiled":
                control_seen = any(e["host"] == "github.com" for e in by_app)
                ctx.proof.check("R628", "control, no policy: the app asks github.com (the compiled endpoint) through the proxy", bool(control_seen), detail)
            elif expect == "off":
                said_off = any((n.get("title") or "") == "Update checks are off" for n in notes) if s.driver is not None else True
                invoked_off = (result or {}).get("v", {}).get("checks_disabled") is True if s.driver is not None else True
                if control_seen:
                    ctx.proof.check("R628", f"{name}: no update request leaves the app", not by_app, detail)
                else:
                    ctx.proof.blocked("R628", f"{name}: no update request leaves the app", "the control saw no request through the proxy, so silence here proves nothing: " + detail)
                if s.driver is not None:
                    ctx.proof.check("R628", f"{name}: the menu check says checks are off, not 'Up to date'", said_off, json.dumps(notes)[:300])
                    ctx.proof.check("R628", f"{name}: igni_check_update answers checks_disabled", invoked_off, json.dumps(result)[:300])
            elif expect == "mirror":
                asked_mirror = any(e["host"] == "mirror.igni.test" for e in by_app)
                asked_other = [h for h in hosts if h != "mirror.igni.test"]
                if not control_seen:
                    ctx.proof.blocked("R628", f"{name}: the managed mirror is asked, and nothing else", "the control saw no request through the proxy: " + detail)
                else:
                    ctx.proof.check("R628", f"{name}: the managed mirror is asked, and nothing else (not github.com, not the user's mirror)", asked_mirror and not asked_other, detail)
                if s.driver is not None:
                    failed = any((n.get("title") or "") == "Couldn't check for updates" for n in notes)
                    ctx.proof.check("R628", f"{name}: the menu check says it could not check (the mirror refused)", failed, json.dumps(notes)[:300])
        finally:
            ctx.write_user_config(None)
            ctx.write_managed(None)


# ─── managed runtime: R612 / R613 / R618 / R620 marker ─────────────────


def pyvenv_mtime(ctx: Ctx) -> float:
    try:
        return (ctx.cache_root / "venv" / "pyvenv.cfg").stat().st_mtime
    except OSError:
        return 0.0


def mount_entries(environ: dict) -> dict:
    out = {}
    for key in ("PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH", "PATH"):
        value = environ.get(key, "")
        hits = [e for e in value.split(os.pathsep) if ".mount_" in e]
        if hits:
            out[key] = hits
    return out


def managed_sessions(ctx: Ctx, app: Path, row_install: str):
    """Fresh managed install from PyPI, the existing venv, Reinstall (Clean)
    from the menu, and --reinstall."""
    if ctx.cache_root.exists():
        shutil.rmtree(ctx.cache_root, ignore_errors=True)
    with Session(ctx, f"{row_install.lower()}-managed-fresh", app=app, args=[ctx.proj]) as s:
        ok = s.connected(40 * 60)
        s.shot("managed-connected")
        s.desktop_shot("managed-connected")
        leaf = backend_leaf(s.app_pid)
        tree = backend_tree(s.app_pid)
        argv0 = cmdline(tree[0])[0] if tree else ""
        venv_py = ctx.cache_root / "venv" / ("Scripts/python.exe" if IS_WIN else "bin/python")
        err = s.loading_error() if s.driver is not None else ""
        ctx.proof.check(row_install, "a clean machine: the app installs its managed runtime (uv, CPython, igni-core from PyPI) and the window connects", ok and same_path(argv0, venv_py), f"connected={ok} argv0={argv0} error={err[:300]}")
        if s.driver is not None and ok:
            tok = marker_token()
            s.send_chat(f"Reply with exactly {tok}.")
            ctx.proof.check(row_install, "the installed app chats (stub model through the managed backend)", s.assistant_said(tok, 120), "")
        if leaf and IS_LINUX and "AppImage" in str(app):
            env = leaf[0].environ()
            hits = mount_entries(env)
            ctx.proof.check("R613", "AppImage, fresh managed cache: no AppImage mount path reaches the backend's PYTHONHOME/PYTHONPATH/LD_LIBRARY_PATH/PATH", not hits, json.dumps(hits))
        text = diagnose(ctx, s)
        ctx.proof.check("R620", "Diagnose (managed): source 'managed venv', the managed interpreter, Actual = pinned version", diag_line(text, "Backend source") == "managed venv" and same_path(diag_line(text, "Interpreter path"), venv_py) and diag_line(text, "Actual ignite-ember") == ctx.version, text[:500])
        marker = ctx.cache_root / "igni-install.json"
        contents = marker.read_text(encoding="utf-8").strip() if marker.exists() else ""
        ctx.proof.check("R620", "Diagnose (managed): the install marker's path and contents are the file on disk", same_path(diag_line(text, "Marker file"), marker) and contents and " ".join(contents.split())[:40] in " ".join(text.split()), f"{diag_line(text, 'Marker contents')[:200]}")
        ctx.proof.check("R620", "Diagnose (managed): Managed venv present is true", diag_line(text, "Managed venv present") == "true", diag_line(text, "Managed venv present"))
        # Reinstall (Clean) from the menu.
        before = pyvenv_mtime(ctx)
        p1 = leaf[0].pid if leaf else None
        time.sleep(1.5)
        ctx.ui.click(s.app_pid, "File", "Reinstall Backend (Clean)")
        if s.driver is not None:
            saw_loading = wait_for(lambda: "loading.html" in s.url(), 20, 0.3)
            ctx.proof.check("R618", "File > Reinstall Backend (Clean) walks the window back to the loading view", bool(saw_loading), s.url()[:120].split("#")[0])
        again = wait_for(lambda: (lambda l: l if l and l[0].pid != p1 else None)(backend_leaf(s.app_pid)), 40 * 60, 2)
        after = pyvenv_mtime(ctx)
        ctx.proof.check("R618", "Reinstall (Clean) rebuilt the managed venv and a new backend runs from it", bool(again) and after > before, f"pyvenv.cfg mtime {before:.0f} -> {after:.0f}; new pid={again[0].pid if again else None}")
        ctx.proof.check("R618", "after Reinstall the window is connected again", s.connected(600), "")
    # The existing venv is reused.
    before = pyvenv_mtime(ctx)
    with Session(ctx, f"{row_install.lower()}-managed-existing", app=app, args=[ctx.proj]) as s:
        t = time.time()
        ok = s.connected(600)
        took = time.time() - t
        ctx.proof.check(row_install, "relaunch: the existing managed venv is reused (no rebuild) and the window connects", ok and pyvenv_mtime(ctx) == before, f"connected in {took:.0f}s")
        leaf = backend_leaf(s.app_pid)
        if leaf and IS_LINUX and "AppImage" in str(app):
            hits = mount_entries(leaf[0].environ())
            ctx.proof.check("R613", "AppImage, existing managed venv: no AppImage mount path reaches the backend", not hits, json.dumps(hits))
    # --reinstall at launch.
    with Session(ctx, f"{row_install.lower()}-managed-reinstall-flag", app=app, args=[ctx.proj, "--reinstall"]) as s:
        ok = s.connected(40 * 60)
        after = pyvenv_mtime(ctx)
        ctx.proof.check("R618", "launching with --reinstall rebuilds the managed venv and the window connects", ok and after > before, f"pyvenv.cfg mtime {before:.0f} -> {after:.0f}")


def appimage_provisioned(ctx: Ctx, app: Path):
    ctx.write_user_config(f"runtime_python: {ctx.core_py}\n")
    try:
        with Session(ctx, "r613-appimage-runtime-python", app=app, args=[ctx.proj]) as s:
            ok = s.connected(300)
            tree = backend_tree(s.app_pid)
            argv0 = cmdline(tree[0])[0] if tree else ""
            ctx.proof.check("R613", "AppImage, runtime_python: the provisioned interpreter runs the backend and the window connects", ok and same_path(argv0, ctx.core_py), f"argv0={argv0}")
            leaf = backend_leaf(s.app_pid)
            if leaf:
                hits = mount_entries(leaf[0].environ())
                ctx.proof.check("R613", "AppImage, runtime_python: no AppImage mount path reaches the backend", not hits, json.dumps(hits))
                appdir = leaf[0].environ().get("APPDIR", "")
                ctx.proof.info("R613", "APPDIR in the backend's environment (left; only the four path variables are scrubbed)", appdir or "<absent>")
    finally:
        ctx.write_user_config(None)


def linux_deb(ctx: Ctx, deb: Path):
    res = subprocess.run(["sudo", "apt-get", "install", "-y", str(deb)], capture_output=True, text=True)
    (ctx.out / "deb-install.log").write_text(res.stdout + res.stderr, encoding="utf-8")
    status = subprocess.run(["dpkg-query", "-W", "-f=${Status} ${Version}", "igni"], capture_output=True, text=True).stdout
    ctx.proof.check("R613", "the .deb installs (dpkg: install ok installed)", "install ok installed" in status, status)
    binary = Path("/usr/bin/igni-app")
    if binary.exists():
        with Session(ctx, "r613-deb-launch", app=binary, args=[ctx.proj]) as s:
            ctx.proof.check("R613", "the installed /usr/bin/igni-app starts on the managed runtime and the window connects", s.connected(600), "")


# ─── Windows: the MSI ──────────────────────────────────────────────────


def windows_msi(ctx: Ctx, msi: Path) -> Path | None:
    log = ctx.out / "msi-install.log"
    res = subprocess.run(["msiexec", "/i", str(msi), "/qn", "/norestart", "/l*v", str(log)], capture_output=True, text=True)
    ctx.proof.check("R612", "the .msi installs silently (msiexec exit 0)", res.returncode == 0, f"exit={res.returncode}")
    import winreg

    found = None
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for base in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"):
            try:
                key = winreg.OpenKey(root, base)
            except OSError:
                continue
            for i in range(winreg.QueryInfoKey(key)[0]):
                try:
                    sub = winreg.OpenKey(key, winreg.EnumKey(key, i))
                    name = winreg.QueryValueEx(sub, "DisplayName")[0]
                except OSError:
                    continue
                if name == "igni":
                    try:
                        version = winreg.QueryValueEx(sub, "DisplayVersion")[0]
                    except OSError:
                        version = ""
                    found = (name, version)
    ctx.proof.check("R612", "Windows lists igni as installed, at the app's version", bool(found) and found[1] == ctx.version, json.dumps(found))
    candidates = []
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("LOCALAPPDATA", "")):
        d = Path(base) / "igni"
        if d.exists():
            candidates += [p for p in d.glob("*.exe") if "uninstall" not in p.name.lower()]
    ctx.proof.check("R612", "the installed program is on disk under Program Files\\igni", bool(candidates), json.dumps([str(c) for c in candidates]))
    shortcut = list(Path(os.environ.get("ProgramData", r"C:\ProgramData"), r"Microsoft\Windows\Start Menu\Programs").rglob("igni*.lnk"))
    ctx.proof.info("R612", "Start Menu shortcut", json.dumps([str(s) for s in shortcut]))
    return candidates[0] if candidates else None


# ─── main ──────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", required=True)
    ap.add_argument("--app", help="the built binary (raw release build)")
    ap.add_argument("--appimage")
    ap.add_argument("--deb")
    ap.add_argument("--msi")
    ap.add_argument("--core", required=True, help="igni-core checkout with a synced .venv")
    ap.add_argument("--version-file", required=True)
    ap.add_argument("--tauri-driver")
    ap.add_argument("--native-driver")
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--only", default="", help="comma-separated scenario names")
    a = ap.parse_args()
    ctx = Ctx(a)
    serve(StubModel, ctx.stub_port)
    serve(ProbeFiles, ctx.probe_port)
    proxy = serve(ConnectProxy(ctx.proxy_port, refuse={"mirror.igni.test", "user-mirror.igni.test"}), ctx.proxy_port)
    ctx.prepare_projects()
    if IS_LINUX:
        subprocess.Popen(["openbox"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)

    only = {s for s in a.only.split(",") if s}

    def want(name):
        return not only or name in only

    if a.app:
        ctx.app = Path(a.app).resolve()
    if IS_WIN and a.msi and want("msi"):
        installed = None
        try:
            installed = windows_msi(ctx, Path(a.msi))
        except Exception as exc:
            ctx.proof.check("R612", "the .msi installs", False, str(exc)[:400])
        if installed:
            ctx.app = installed
            guarded(ctx, "R612", "R612 managed runtime on the installed app", lambda: managed_sessions(ctx, installed, "R612"))
    scenarios = [
        ("r617-unack", "R617", lambda: r617_unacknowledged(ctx)),
        ("r617-ack", "R617", lambda: r617_acknowledged(ctx)),
        ("override", "R620", lambda: override_session(ctx)),
        ("menus", "R624", lambda: menus_and_restart_session(ctx)),
        ("attached", "R618", lambda: attached_session(ctx)),
        ("provisioned", "R620", lambda: provisioned_session(ctx)),
        ("r628", "R628", lambda: r628_session(ctx, proxy)),
    ]
    if ctx.app:
        for name, row, fn in scenarios:
            if want(name):
                guarded(ctx, row, name, fn)
    if IS_LINUX and a.appimage and want("appimage"):
        appimage = Path(a.appimage).resolve()
        guarded(ctx, "R613", "R613 AppImage managed runtime", lambda: managed_sessions(ctx, appimage, "R613"))
        guarded(ctx, "R613", "R613 AppImage runtime_python", lambda: appimage_provisioned(ctx, appimage))
    if IS_LINUX and a.deb and want("deb"):
        guarded(ctx, "R613", "R613 deb", lambda: linux_deb(ctx, Path(a.deb).resolve()))
    ctx.proof.flush()
    print(json.dumps(json.loads((ctx.out / "summary.json").read_text()), indent=2))
    return 1 if ctx.proof.failed() else 0


if __name__ == "__main__":
    sys.exit(main())
