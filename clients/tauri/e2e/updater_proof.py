# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "selenium==4.53.0",
#   "psutil==7.2.2",
#   "cryptography==50.0.1",
#   "pywinauto==0.6.9; sys_platform == 'win32'",
#   "pillow==12.0.0; sys_platform == 'win32'",
# ]
# ///
"""Prove that the installed desktop app updates itself (campaign row R627).

Run by ``.github/workflows/updater-e2e-proof.yml`` after
``updater_builds.sh`` built version A and version B with a throwaway
updater key. It:

1. makes a throwaway "corporate" certificate authority and serves
   ``latest.json`` and B's payload over HTTPS as ``mirror.igni.test`` (a
   hosts-file name for 127.0.0.1) with a certificate only that CA signed:
   the updater plugin refuses plain HTTP, and the build keeps that. First
   with the CA in no trust store, where the app must refuse the mirror
   (F13); then with the CA in the OS store (update-ca-certificates,
   certutil, the System keychain), as IT installs a company CA, for
   everything below;
2. installs A the way a user does (the AppImage in a folder, the .msi, the
   NSIS setup, the .app in an Applications folder);
3. points A at the local endpoint through ``update_endpoint`` in
   ``~/.igni/config.yaml``, the deployment setting the shell already reads
   (``src/update_policy.rs``), so no endpoint is compiled in for the test;
4. launches A on a signed-in, trusted project folder (the developer backend
   override, igni-core at the app's version), waits for the update banner
   the startup check shows, and clicks its "Install & restart" button:
   - with the CA untrusted: no banner, no HTTP request reaches the mirror,
     the app's TLS aborts the handshake with ``unknown_ca``, and (where
     WebDriver can ask) the check and the install fail naming the mirror,
     the certificate and what to do about it;
   - with ``update_check_ttl: 0`` no request reaches the endpoint at all;
   - a payload signed by a different key is refused, A stays installed;
   - a tampered payload is refused, A stays installed;
   - the genuine payload is downloaded, verified, installed, and the app
     relaunches;
5. checks that what runs and what is installed is B.

WebDriver (tauri-driver) drives the webview on Linux. macOS has no
WebDriver for WKWebView, and on the Windows runner msedgedriver never gets a
session on the app's WebView2 ("DevToolsActivePort file doesn't exist",
also when attaching to a DevTools port opened by policy), so on both the
banner is read and pressed through the accessibility API (System Events,
UI Automation), as a screen reader would.

Every check lands in ``<out>/verdicts.json`` as it is made; the exit status
is non-zero if any failed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.server
import ipaddress
import json
import os
import plistlib
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tarfile
import threading
import time
import traceback
from pathlib import Path

import psutil

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")

ROW = "R627"
CA_ROW = "F13"
# The enterprise mirror's name: a hosts-file entry for 127.0.0.1, so the
# certificate is checked against a DNS name, as a real mirror's is.
MIRROR_HOST = "mirror.igni.test"
APP_NAMES = {"igni-app", "igni", "igni-app.exe", "igni.exe"}
STUB_MODEL = "e2e-updater-stub"
INSTALL_BUTTON = "Install & restart"
# minisign-verify's own messages, which the banner shows as the plugin
# returns them (ShellError serializes as its message).
WRONG_KEY_ERROR = r"created with a different key"
TAMPERED_ERROR = r"signature verification failed"
# What the shell says when the mirror's certificate comes from a CA the
# system does not trust (src/error.rs, UpdaterFailure).
UNTRUSTED_CA_ERROR = r"invalid peer certificate: UnknownIssuer\. The update server's certificate is not signed by an authority this computer trusts"
# The alert the app's rustls sends when it refuses the issuer, as the
# mirror's OpenSSL reports it.
UNKNOWN_CA_ALERT = r"ALERT_UNKNOWN_CA|unknown ca"
COMPOSER_READY_JS = (
    "const e = document.querySelector('.composer-editable');"
    "return !!(e && /Message (Ember|igni)/.test(e.dataset.placeholder || ''));"
)
PROMPT_JS = (
    "const p = document.querySelector('.update-prompt');"
    "if (!p) return null;"
    "const err = p.querySelector('.update-prompt-error');"
    "const btn = [...p.querySelectorAll('button')].map(b => ({text: b.innerText.trim(), disabled: b.disabled}));"
    "return {text: p.innerText, error: err ? err.innerText : '', buttons: btn};"
)
INVOKE_JS = (
    "const done = arguments[arguments.length - 1];"
    "const inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;"
    "if (!inv) { done({ok: false, error: 'no __TAURI__.core.invoke'}); return; }"
    "inv(arguments[0]).then(v => done({ok: true, value: v}), e => done({ok: false, error: String(e)}));"
)
VERSION_JS = (
    "const done = arguments[arguments.length - 1];"
    "window.__TAURI__.app.getVersion().then(v => done({ok: true, value: v}), e => done({ok: false, error: String(e)}));"
)


# ─── the record ────────────────────────────────────────────────────────


class Proof:
    def __init__(self, out: Path, platform: str, kind: str):
        self.out = out
        self.platform = platform
        self.kind = kind
        self.results: list[dict] = []
        out.mkdir(parents=True, exist_ok=True)

    def _add(self, check: str, status: str, detail: str, row: str = ROW) -> bool:
        entry = {
            "row": row,
            "check": check,
            "status": status,
            "detail": detail,
            "platform": self.platform,
            "installer": self.kind,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        self.results.append(entry)
        print(f"[{status}] {row} · {check}" + (f" :: {detail}" if detail else ""), flush=True)
        self.flush()
        return status == "PASS"

    def check(self, check: str, ok: bool, detail: str = "", row: str = ROW) -> bool:
        return self._add(check, "PASS" if ok else "FAIL", detail, row)

    def info(self, check: str, detail: str, row: str = ROW) -> None:
        self._add(check, "INFO", detail, row)

    def blocked(self, check: str, why: str, row: str = ROW) -> None:
        self._add(check, "BLOCKED", why, row)

    def flush(self) -> None:
        (self.out / "verdicts.json").write_text(json.dumps(self.results, indent=2), encoding="utf-8")

    def failed(self) -> bool:
        return any(r["status"] in ("FAIL", "BLOCKED") for r in self.results)


def wait_for(fn, timeout: float, interval: float = 0.7):
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


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ─── a certificate authority the OS trusts, for the duration ──────────


def make_tls(work: Path) -> tuple[Path, Path, Path]:
    """A throwaway "corporate" CA and the mirror's certificate it signed,
    for mirror.igni.test (and 127.0.0.1/localhost)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    now = dt.datetime.now(dt.timezone.utc)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "igni updater e2e throwaway corporate CA")])
    ca = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(hours=1))
        .not_valid_after(now + dt.timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_cert_sign=True, crl_sign=True, content_commitment=False,
                key_encipherment=False, data_encipherment=False, key_agreement=False,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    key = ec.generate_private_key(ec.SECP256R1())
    leaf = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, MIRROR_HOST)]))
        .issuer_name(ca_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(hours=1))
        .not_valid_after(now + dt.timedelta(days=2))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName(MIRROR_HOST),
                x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                x509.DNSName("localhost"),
            ]),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_cert_sign=False, crl_sign=False, content_commitment=False,
                key_encipherment=False, data_encipherment=False, key_agreement=True,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    tls = work / "tls"
    tls.mkdir(parents=True, exist_ok=True)
    ca_pem, cert_pem, key_pem = tls / "ca.crt", tls / "server.crt", tls / "server.key"
    ca_pem.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    cert_pem.write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
    key_pem.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    return ca_pem, cert_pem, key_pem


def map_mirror_name() -> None:
    """``mirror.igni.test`` → 127.0.0.1 in the hosts file, for the run."""
    line = f"127.0.0.1 {MIRROR_HOST}"
    if IS_WIN:
        hosts = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "drivers" / "etc" / "hosts"
        with open(hosts, "a", encoding="ascii") as f:
            f.write(f"\r\n{line}\r\n")
        subprocess.run(["ipconfig", "/flushdns"], check=False, stdout=subprocess.DEVNULL)
    else:
        subprocess.run(["sudo", "sh", "-c", f"printf '\\n%s\\n' '{line}' >> /etc/hosts"], check=True)
        if IS_MAC:
            subprocess.run(["sudo", "dscacheutil", "-flushcache"], check=False)
            subprocess.run(["sudo", "killall", "-HUP", "mDNSResponder"], check=False)


def trust_ca(ca: Path) -> None:
    """Into the store the updater's TLS (rustls-platform-verifier) reads."""
    if IS_LINUX:
        subprocess.run(["sudo", "cp", str(ca), "/usr/local/share/ca-certificates/igni-updater-e2e.crt"], check=True)
        subprocess.run(["sudo", "update-ca-certificates"], check=True, stdout=subprocess.DEVNULL)
    elif IS_WIN:
        subprocess.run(["certutil", "-addstore", "-f", "Root", str(ca)], check=True, stdout=subprocess.DEVNULL)
    else:
        subprocess.run(
            ["sudo", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain", str(ca)],
            check=True,
        )


# ─── the update endpoint ──────────────────────────────────────────────


# The stash release.yml's build legs upload for each installer kind
# (scripts/latest-json.mjs's LEGS), and the release asset name each one's
# latest.json entry points at.
STASHES = {
    "appimage": "updater-sig-linux-appimage",
    "msi": "updater-sig-windows-msi",
    "nsis": "updater-sig-windows-nsis",
    "app": "updater-sig-aarch64",
}
MAC_ASSET = "igni_aarch64.app.tar.gz"  # the stapled tarball's release name


class UpdateServer:
    """``latest.json`` and B's payloads, in one of three modes:

    ``good``      B's payloads with the signatures their builds wrote
    ``wrongkey``  B's payloads with signatures from the other throwaway key
    ``tampered``  B's payloads with one byte flipped, and B's own signatures

    latest.json itself is what the release's ``updater-json`` job would
    publish: ``scripts/latest-json.mjs`` run on the stashes the build legs
    would upload, one per installer kind this runner has a B for (on Windows
    both the .msi and the NSIS setup, so an install proves it takes its own
    entry and not the other's, nor the default).
    """

    def __init__(self, ctx: "Ctx", cert: Path, key: Path):
        self.ctx = ctx
        self.port = free_port()
        self.base = f"https://{MIRROR_HOST}:{self.port}"
        self.work = ctx.work / "endpoint"
        self.legs: dict[str, dict] = {}
        self.served: dict[str, Path] = {}
        for kind, files in ctx.all_kinds.items():
            payload = ctx.stage / files["b"]
            asset = MAC_ASSET if kind == "app" else payload.name
            tampered = self.work / "tampered" / asset
            tampered.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(payload, tampered)
            with open(tampered, "r+b") as f:
                f.seek(tampered.stat().st_size // 2)
                b = f.read(1)
                f.seek(-1, 1)
                f.write(bytes([b[0] ^ 0xFF]))
            self.legs[kind] = {
                "stash": STASHES[kind],
                "asset": asset,
                "sig": (ctx.stage / files["b_sig"]).read_text().strip(),
                "wrong_sig": (ctx.stage / files["b_wrong_sig"]).read_text().strip(),
            }
            self.served[f"/dl/{asset}"] = payload
            self.served[f"/dl/tampered/{asset}"] = tampered
        self.manifests = {mode: self._assemble(mode) for mode in ("good", "wrongkey", "tampered")}
        for mode, m in self.manifests.items():
            (ctx.out / f"latest-{mode}.json").write_text(json.dumps(m, indent=2), encoding="utf-8")
        self.mode = "good"
        self.hits: list[dict] = []
        # Handshakes that failed, with the reason OpenSSL gives (for a
        # client that refused our certificate, the alert it sent).
        self.tls_failures: list[dict] = []
        self.log_to: Path | None = None
        self.lock = threading.Lock()
        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_GET(self):
                with server.lock:
                    server.hits.append({"t": time.time(), "path": self.path, "mode": server.mode,
                                        "ua": self.headers.get("User-Agent", "")})
                    if server.log_to:
                        server.log_to.write_text(json.dumps(server.hits, indent=2), encoding="utf-8")
                if self.path.split("?")[0] == "/latest.json":
                    body = json.dumps(server.manifest()).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                path = server.served.get(self.path.split("?")[0])
                if path is None:
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(path.stat().st_size))
                self.end_headers()
                with open(path, "rb") as f:
                    shutil.copyfileobj(f, self.wfile, 1 << 20)

        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(str(cert), str(key))

        class MirrorServer(http.server.ThreadingHTTPServer):
            """Runs each handshake itself, so a client that refuses the
            certificate is recorded rather than lost in serve_forever."""

            def get_request(self):
                sock, addr = self.socket.accept()
                sock.settimeout(30)
                try:
                    conn = tls.wrap_socket(sock, server_side=True)
                except OSError as e:  # ssl.SSLError included
                    with server.lock:
                        server.tls_failures.append({"t": time.time(), "peer": addr[0], "reason": str(e)})
                    sock.close()
                    raise
                conn.settimeout(None)
                return conn, addr

        self.httpd = MirrorServer(("127.0.0.1", self.port), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def _assemble(self, mode: str) -> dict:
        """latest.json for ``mode``, by the release's own script."""
        sigs = self.work / "stashes" / mode
        for leg in self.legs.values():
            d = sigs / leg["stash"]
            d.mkdir(parents=True, exist_ok=True)
            (d / "updater.sig").write_text(leg["wrong_sig"] if mode == "wrongkey" else leg["sig"], encoding="utf-8")
            if leg["stash"] != STASHES["app"]:
                (d / "asset").write_text(leg["asset"] + "\n", encoding="utf-8")
        out = self.work / f"latest-{mode}.json"
        base = f"{self.base}/dl/tampered" if mode == "tampered" else f"{self.base}/dl"
        subprocess.run(
            ["node", str(self.ctx.latest_json_script), "--sigs", str(sigs), "--version", self.ctx.version_b,
             "--base-url", base, "--pub-date", "2026-11-20T00:00:00Z",
             "--notes", f"updater e2e proof ({mode})", "--out", str(out)],
            check=True, stdout=subprocess.DEVNULL,
        )
        return json.loads(out.read_text(encoding="utf-8"))

    @property
    def endpoint(self) -> str:
        return f"{self.base}/latest.json"

    @property
    def own_asset(self) -> str:
        """The asset this runner's install must fetch, and no other."""
        return self.legs[self.ctx.kind]["asset"]

    def manifest(self) -> dict:
        return self.manifests[self.mode]

    def set_mode(self, mode: str) -> None:
        with self.lock:
            self.mode = mode

    def mark(self) -> int:
        with self.lock:
            return len(self.hits)

    def since(self, mark: int) -> list[dict]:
        with self.lock:
            return list(self.hits[mark:])

    def tls_mark(self) -> int:
        with self.lock:
            return len(self.tls_failures)

    def tls_failures_since(self, mark: int) -> list[dict]:
        with self.lock:
            return list(self.tls_failures[mark:])

    def save(self, out: Path) -> None:
        (out / "endpoint-requests.json").write_text(json.dumps(self.hits, indent=2), encoding="utf-8")
        (out / "endpoint-tls-failures.json").write_text(json.dumps(self.tls_failures, indent=2), encoding="utf-8")


def downloads(hits: list[dict]) -> list[dict]:
    return [h for h in hits if h["path"].startswith("/dl/")]


def manifests(hits: list[dict]) -> list[dict]:
    return [h for h in hits if h["path"].startswith("/latest.json")]


# ─── a model that answers, so the backend is a normal one ─────────────


class StubModel(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json({"object": "list", "data": [{"id": STUB_MODEL, "object": "model"}]})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        self._json({
            "id": "chatcmpl-stub", "object": "chat.completion", "created": int(time.time()), "model": STUB_MODEL,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "STUB-OK"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        })


# ─── processes ─────────────────────────────────────────────────────────


def app_processes(since: float = 0.0) -> list[psutil.Process]:
    out = []
    for proc in psutil.process_iter(["name", "create_time"]):
        try:
            if (proc.info["name"] or "").lower() in APP_NAMES and proc.info["create_time"] >= since - 1:
                out.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return out


def describe(proc: psutil.Process) -> dict:
    try:
        return {"pid": proc.pid, "name": proc.name(), "exe": proc.exe(), "cmdline": proc.cmdline(),
                "started": time.strftime("%H:%M:%S", time.localtime(proc.create_time())),
                "create_time": proc.create_time()}
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess) as exc:
        return {"pid": proc.pid, "error": str(exc)}


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
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def backend_has_client(app_pid: int) -> bool:
    """macOS readiness without WebDriver: the backend the app started has a
    client connected to the port it listens on."""
    try:
        kids = psutil.Process(app_pid).children(recursive=True)
    except psutil.NoSuchProcess:
        return False
    for k in kids:
        try:
            conns = k.net_connections(kind="tcp")
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        listening = {c.laddr.port for c in conns if c.status == psutil.CONN_LISTEN and c.laddr}
        if any(c.status == psutil.CONN_ESTABLISHED and c.laddr and c.laddr.port in listening for c in conns):
            return True
    return False


# ─── the installed app ────────────────────────────────────────────────


class Installed:
    """A, installed the way a user installs it; what is on disk now."""

    def __init__(self, ctx: "Ctx"):
        self.ctx = ctx
        self.exe: Path | None = None   # what is launched
        self.target: Path | None = None  # what the updater replaces

    def install_a(self) -> None:
        kind, a = self.ctx.kind, self.ctx.stage / self.ctx.files["a"]
        apps = self.ctx.work / "Applications"
        apps.mkdir(parents=True, exist_ok=True)
        if kind == "appimage":
            self.target = apps / "igni.AppImage"
            shutil.copyfile(a, self.target)
            self.target.chmod(0o755)
            self.exe = self.target
        elif kind == "app":
            self.target = apps / a.name
            if self.target.exists():
                shutil.rmtree(self.target)
            subprocess.run(["ditto", str(a), str(self.target)], check=True)
            self.exe = self.target / "Contents" / "MacOS" / "igni-app"
            if not self.exe.exists():
                self.exe = next(p for p in (self.target / "Contents" / "MacOS").iterdir() if os.access(p, os.X_OK))
        elif kind == "msi":
            log = self.ctx.out / "msi-install-A.log"
            res = subprocess.run(["msiexec", "/i", str(a), "/qn", "/norestart", "/l*v", str(log)], timeout=600)
            if res.returncode != 0:
                raise RuntimeError(f"msiexec exited {res.returncode}; see {log.name}")
            self.exe = self.windows_exe()
            self.target = self.exe
        elif kind == "nsis":
            res = subprocess.run([str(a), "/S"], timeout=600)
            if res.returncode != 0:
                raise RuntimeError(f"NSIS setup exited {res.returncode}")
            self.exe = wait_for(self.windows_exe, 60)
            self.target = self.exe
        if not self.exe or not Path(self.exe).exists():
            raise RuntimeError(f"no installed program found for {kind}")

    @staticmethod
    def windows_exe() -> Path | None:
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("LOCALAPPDATA", "")):
            d = Path(base) / "igni"
            if d.exists():
                exes = [p for p in d.glob("*.exe") if "uninstall" not in p.name.lower()]
                if exes:
                    return exes[0]
        return None

    @staticmethod
    def windows_registered() -> list[dict]:
        import winreg

        found = []
        for hive, path in (
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ):
            try:
                key = winreg.OpenKey(hive, path)
            except OSError:
                continue
            for i in range(winreg.QueryInfoKey(key)[0]):
                try:
                    sub = winreg.OpenKey(key, winreg.EnumKey(key, i))
                    name = winreg.QueryValueEx(sub, "DisplayName")[0]
                except OSError:
                    continue
                if name == "igni":
                    entry = {"hive": "HKLM" if hive == winreg.HKEY_LOCAL_MACHINE else "HKCU", "key": winreg.EnumKey(key, i)}
                    for value in ("DisplayVersion", "InstallLocation"):
                        try:
                            entry[value] = winreg.QueryValueEx(sub, value)[0]
                        except OSError:
                            entry[value] = ""
                    found.append(entry)
        return found

    def state(self) -> dict:
        """What is installed, in a form two moments can be compared by."""
        out: dict = {}
        if self.target is None or not Path(self.target).exists():
            return {"missing": True}
        if self.ctx.kind == "appimage":
            out["sha256"] = sha256(self.target)
        elif self.ctx.kind == "app":
            out["binary_sha256"] = sha256(self.exe) if Path(self.exe).exists() else ""
            try:
                with open(self.target / "Contents" / "Info.plist", "rb") as f:
                    plist = plistlib.load(f)
                out["CFBundleShortVersionString"] = plist.get("CFBundleShortVersionString")
                out["CFBundleVersion"] = plist.get("CFBundleVersion")
            except Exception as exc:
                out["plist_error"] = str(exc)
        else:
            out["exe_sha256"] = sha256(self.exe) if Path(self.exe).exists() else ""
            out["registered"] = self.windows_registered()
        return out

    def matches_b(self, state: dict) -> tuple[bool, str]:
        """Whether ``state`` is version B's payload."""
        b = self.ctx.stage / self.ctx.files["b"]
        vb = self.ctx.version_b
        if self.ctx.kind == "appimage":
            want = sha256(b)
            return state.get("sha256") == want, f"installed sha256 {state.get('sha256', '')[:16]} vs B's AppImage {want[:16]}"
        if self.ctx.kind == "app":
            with tarfile.open(b) as t:
                member = next(m for m in t.getmembers() if m.isfile() and m.name.endswith(f"/Contents/MacOS/{Path(self.exe).name}"))
                want = hashlib.sha256(t.extractfile(member).read()).hexdigest()
            return state.get("binary_sha256") == want, f"installed binary {state.get('binary_sha256', '')[:16]} vs B's payload {want[:16]}"
        versions = [r.get("DisplayVersion", "") for r in state.get("registered", [])]
        norm = lambda v: v.replace("-", ".")
        return any(norm(v) == norm(vb) for v in versions), f"registered DisplayVersion {versions} vs B {vb}"


# ─── one launch ───────────────────────────────────────────────────────


class Session:
    """One launch of the installed app. WebDriver on Linux/Windows; a plain
    process on macOS."""

    def __init__(self, ctx: "Ctx", name: str):
        self.ctx = ctx
        self.name = name
        self.dir = ctx.out / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.driver = None
        self.td = None
        self.proc = None
        self.app_pid: int | None = None
        self.t0 = 0.0

    def env(self) -> dict:
        env = {k: v for k, v in os.environ.items() if not k.startswith(("IGNI_", "IGNITE_"))}
        for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "VIRTUAL_ENV"):
            env.pop(k, None)
        env["IGNI_DEV_BACKEND"] = str(self.ctx.core_py)
        env["IGNITE_EMBER_DEV"] = "1"
        env["NO_PROXY"] = env["no_proxy"] = f"127.0.0.1,localhost,::1,{MIRROR_HOST}"
        return env

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()

    def start(self):
        self.t0 = time.time()
        env = self.env()
        log = open(self.dir / "app.log", "a", encoding="utf-8", errors="replace")
        args = [str(self.ctx.proj)]
        if self.ctx.webdriver:
            from selenium import webdriver
            from selenium.webdriver.common.options import ArgOptions

            env["TAURI_WEBVIEW_AUTOMATION"] = "true"
            port = free_port()
            cmd = [self.ctx.tauri_driver, "--port", str(port)]
            if IS_WIN:
                cmd += ["--native-driver", self.ctx.native_driver]
            self.td = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT)
            if not wait_for(lambda: socket.create_connection(("127.0.0.1", port), timeout=1).close() or True, 30):
                raise RuntimeError("tauri-driver did not listen")
            opts = ArgOptions()
            opts.set_capability("browserName", "wry")
            opts.set_capability("tauri:options", {"application": str(self.ctx.installed.exe), "args": args})
            from selenium.webdriver.remote.client_config import ClientConfig

            # Bounded: a WebKitWebDriver call that never answers must fail
            # the check, not hold the job until its timeout.
            config = ClientConfig(remote_server_addr=f"http://127.0.0.1:{port}", timeout=180)
            self.driver = webdriver.Remote(command_executor=f"http://127.0.0.1:{port}", options=opts, client_config=config)
            self.driver.set_script_timeout(90)
        else:
            self.proc = subprocess.Popen([str(self.ctx.installed.exe), *args], env=env, stdout=log, stderr=subprocess.STDOUT)
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
        for h in (self.proc, self.td):
            if h is not None:
                kill_tree(h.pid)
        for proc in psutil.process_iter(["create_time", "cmdline"]):
            try:
                if proc.info["create_time"] >= self.t0 - 1 and "igni_core" in " ".join(proc.info["cmdline"] or []):
                    proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        time.sleep(2)

    # webview ----------------------------------------------------------

    def js(self, script: str, *args):
        return self.driver.execute_script(script, *args)

    def invoke(self, command: str) -> dict:
        return self.driver.execute_async_script(INVOKE_JS, command)

    def version(self) -> dict:
        return self.driver.execute_async_script(VERSION_JS)

    def loading_error(self) -> str:
        try:
            return self.js("const e = document.querySelector('.igni-loading-error'); return e ? e.textContent : '';") or ""
        except Exception:
            return ""

    def connected(self, timeout: float = 300) -> bool:
        if self.driver is None:
            return bool(wait_for(lambda: backend_has_client(self.app_pid), timeout, 1))
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.js(COMPOSER_READY_JS):
                    return True
            except Exception:
                pass
            err = self.loading_error()
            if err:
                (self.dir / "bootstrap-error.txt").write_text(err, encoding="utf-8")
                return False
            time.sleep(1)
        return False

    def shot(self, label: str):
        if self.driver is not None:
            try:
                self.driver.save_screenshot(str(self.dir / f"{label}.png"))
            except Exception:
                pass
        elif IS_MAC:
            subprocess.run(["screencapture", "-x", str(self.dir / f"{label}.png")], timeout=30, check=False)
        elif IS_WIN:
            try:
                from PIL import ImageGrab

                ImageGrab.grab().save(self.dir / f"{label}.png")
            except Exception:
                pass

    # the banner -------------------------------------------------------

    def prompt(self) -> dict | None:
        if self.driver is not None:
            return self.js(PROMPT_JS)
        return self.ctx.ax.prompt(self.app_pid)

    def wait_prompt(self, timeout: float) -> dict | None:
        return wait_for(self.prompt, timeout, 1.5)

    def click_install(self) -> None:
        if self.driver is not None:
            # A click event on the button itself, dispatched by the page
            # rather than through WebKitWebDriver's element click, which
            # waits on the page and never answered while the install ran.
            found = self.js(
                "const b = [...document.querySelectorAll('.update-prompt button')]"
                ".find(b => b.innerText.trim() === arguments[0]);"
                "if (!b) return false; setTimeout(() => b.click(), 0); return true;",
                INSTALL_BUTTON,
            )
            if not found:
                raise RuntimeError("no Install & restart button")
            return
        self.ctx.ax.press(self.app_pid, INSTALL_BUTTON)

    def dismiss(self) -> None:
        if self.driver is not None:
            self.js(
                "const b = [...document.querySelectorAll('.update-prompt button')]"
                ".find(b => b.innerText.trim() === 'Later'); if (b) b.click();"
            )

    def reload(self) -> None:
        """Run the startup sequence again (and with it the silent check)."""
        self.js("location.reload()")
        time.sleep(2)


# ─── macOS: the banner through the accessibility API ──────────────────


class NativeAX:
    """The banner through the platform's accessibility API: ``elements``
    gives (role, text) rows, ``press`` presses a button by its title."""

    def elements(self, pid: int) -> list[tuple[str, str]]:
        raise NotImplementedError

    def press(self, pid: int, title: str) -> None:
        raise NotImplementedError

    def prompt(self, pid: int) -> dict | None:
        rows = self.elements(pid)
        texts = [t for r, t in rows if r == "AXStaticText"]
        buttons = [t for r, t in rows if r == "AXButton"]
        if "Update available" not in texts and INSTALL_BUTTON not in buttons and "Installing…" not in buttons:
            return None
        joined = "\n".join(texts)
        # The error line (src/components/UpdatePrompt.tsx) is the text that
        # reads like one; the title and body never do.
        error = [t for t in texts if re.search(r"(?i)signature|verif|error|invalid|failed|refused|decode|key", t)]
        return {"text": joined, "error": "\n".join(error), "buttons": [{"text": b, "disabled": False} for b in buttons]}


class WinUIA(NativeAX):
    """UI Automation (pywinauto). WebView2 puts the page's content in the
    UIA tree under the app's window."""

    ROLES = {"Button": "AXButton", "Text": "AXStaticText"}

    def _windows(self, pid: int):
        from pywinauto import Desktop

        return [w for w in Desktop(backend="uia").windows() if w.process_id() == pid]

    def _walk(self, pid: int):
        for w in self._windows(pid):
            for e in w.descendants():
                try:
                    role = self.ROLES.get(e.element_info.control_type)
                except Exception:
                    continue
                if role:
                    yield role, e

    def elements(self, pid):
        rows = []
        for role, e in self._walk(pid):
            try:
                rows.append((role, e.window_text()))
            except Exception:
                continue
        return rows

    def press(self, pid, title):
        for role, e in self._walk(pid):
            try:
                if role == "AXButton" and e.window_text() == title:
                    e.invoke()
                    return
            except Exception:
                continue
        raise RuntimeError(f"no button {title}")


class MacAX(NativeAX):
    """System Events. WKWebView's web content is in the accessibility tree,
    so the banner's text and its buttons can be read and pressed."""

    def _osa(self, script: str, timeout: float = 180) -> str:
        res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            raise RuntimeError(f"osascript: {res.stderr.strip()[-600:]}")
        return res.stdout

    def elements(self, pid: int) -> list[tuple[str, str]]:
        script = f"""
        tell application "System Events"
          set p to (first process whose unix id is {pid})
          set out to ""
          repeat with w in windows of p
            set els to entire contents of w
            repeat with e in els
              try
                set r to role of e
                if r is "AXButton" or r is "AXStaticText" then
                  set t to ""
                  try
                    set t to (name of e) as text
                  end try
                  if t is "" or t is "missing value" then
                    try
                      set t to (value of e) as text
                    end try
                  end if
                  if t is "" or t is "missing value" then
                    try
                      set t to (description of e) as text
                    end try
                  end if
                  set out to out & r & "|" & t & linefeed
                end if
              end try
            end repeat
          end repeat
          return out
        end tell"""
        rows = []
        for line in self._osa(script).splitlines():
            role, _, text = line.partition("|")
            rows.append((role, text))
        return rows

    def press(self, pid: int, title: str) -> None:
        self._osa(
            f"""tell application "System Events"
              set p to (first process whose unix id is {pid})
              set frontmost of p to true
              repeat with w in windows of p
                set els to entire contents of w
                repeat with e in els
                  try
                    if role of e is "AXButton" and ((name of e) as text) is "{title}" then
                      perform action "AXPress" of e
                      return "pressed"
                    end if
                  end try
                  try
                    if role of e is "AXButton" and ((description of e) as text) is "{title}" then
                      perform action "AXPress" of e
                      return "pressed"
                    end if
                  end try
                end repeat
              end repeat
              error "no button {title}"
            end tell"""
        )


# ─── context ───────────────────────────────────────────────────────────


class Ctx:
    def __init__(self, a: argparse.Namespace):
        self.out = Path(a.out).resolve()
        self.work = Path(a.work).resolve()
        self.work.mkdir(parents=True, exist_ok=True)
        self.stage = Path(a.stage).resolve()
        manifest = json.loads((self.stage / "manifest.json").read_text())
        self.kind = a.kind
        self.files = manifest["kinds"][a.kind]
        self.all_kinds = manifest["kinds"]
        self.latest_json_script = Path(a.latest_json_script).resolve()
        self.version_a = manifest["version_a"]
        self.version_b = manifest["version_b"]
        self.platform = manifest["platform"]
        self.proof = Proof(self.out, self.platform, self.kind)
        self.core = Path(a.core).resolve()
        self.core_py = self.core / ".venv" / ("Scripts/python.exe" if IS_WIN else "bin/python")
        self.webdriver = bool(a.tauri_driver)
        self.tauri_driver = a.tauri_driver
        self.native_driver = a.native_driver
        self.proj = (self.work / "igni-updater-project").resolve()
        self.stub_port = free_port()
        self.installed = Installed(self)
        self.ax: NativeAX | None = MacAX() if IS_MAC else WinUIA() if IS_WIN else None

    @property
    def user_config(self) -> Path:
        return Path.home() / ".igni" / "config.yaml"

    def write_user_config(self, text: str) -> None:
        self.user_config.parent.mkdir(parents=True, exist_ok=True)
        self.user_config.write_text(text, encoding="utf-8")
        (self.out / "config-history.log").open("a", encoding="utf-8").write(f"--- {time.strftime('%H:%M:%S')}\n{text}\n")

    def prepare_project(self) -> None:
        """A trusted folder whose backend reads as signed in and answers from
        a stub model (as the web client's live-backend fixture does)."""
        folder = self.proj
        (folder / ".igni").mkdir(parents=True, exist_ok=True)
        (folder / "README.md").write_text("# updater e2e proof\n", encoding="utf-8")
        subprocess.run(["git", "init", "--quiet"], cwd=folder, check=False)
        creds = folder / ".igni" / "credentials.json"
        year = 365 * 24 * 3600
        creds.write_text(json.dumps({
            "access_token": "e2e-fixture-token",
            "token_type": "bearer",
            "email": "fixture@example.com",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + year)),
        }), encoding="utf-8")
        (folder / ".igni" / "config.local.yaml").write_text("\n".join([
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
        ]), encoding="utf-8")
        subprocess.run(
            [str(self.core_py), "-c",
             "import sys; from igni_core.core.workspace_trust.service import WorkspaceTrust; WorkspaceTrust().trust(sys.argv[1])",
             str(folder)],
            check=True,
        )


# ─── the scenarios ────────────────────────────────────────────────────


def mirror_name_and_certificate(ctx: Ctx, ca: Path) -> None:
    """The name resolves to the local mirror, and its certificate is good
    for that name but chains to the throwaway CA alone: no public root
    vouches for it, so whatever trusts it later trusts the CA."""
    srv = ctx.server
    try:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(MIRROR_HOST, srv.port, proto=socket.IPPROTO_TCP)})
    except OSError as e:
        addrs = [f"{type(e).__name__}: {e}"]
    ctx.proof.check(f"corporate CA mirror: {MIRROR_HOST} resolves to the local mirror", "127.0.0.1" in addrs,
                    json.dumps(addrs), row=CA_ROW)

    def handshake(context: ssl.SSLContext) -> str:
        try:
            with socket.create_connection((MIRROR_HOST, srv.port), timeout=15) as raw:
                with context.wrap_socket(raw, server_hostname=MIRROR_HOST) as t:
                    return f"verified: {t.version()}"
        except ssl.SSLCertVerificationError as e:
            return f"refused: {e.verify_message}"
        except OSError as e:
            return f"error: {type(e).__name__}: {e}"

    public = handshake(ssl.create_default_context())
    ctx.proof.check("corporate CA mirror: the public roots refuse the mirror's certificate", public.startswith("refused"),
                    public, row=CA_ROW)
    own = handshake(ssl.create_default_context(cafile=str(ca)))
    ctx.proof.check(f"corporate CA mirror: the corporate CA verifies it for {MIRROR_HOST}", own.startswith("verified"),
                    own, row=CA_ROW)


def untrusted_mirror(ctx: Ctx) -> None:
    """The CA in no trust store: the app asks the mirror and refuses it at
    the handshake. No banner, nothing fetched, and the answer says why."""
    srv = ctx.server
    srv.set_mode("good")
    mark, tls_mark = srv.mark(), srv.tls_mark()
    label = "corporate CA not trusted"
    with Session(ctx, "untrusted-ca") as s:
        if not s.connected(300):
            ctx.proof.check(f"{label}: the app connects to its backend", False, s.loading_error()[:400], row=CA_ROW)
            return
        refused = wait_for(lambda: srv.tls_failures_since(tls_mark), 90, 1) or []
        time.sleep(10)  # a banner, had the check gone through
        prompt = s.prompt()
        if s.driver is not None:
            chk = s.invoke("igni_check_update")
            error = chk.get("error", "")
            ctx.proof.check(f"{label}: igni_check_update fails, naming the mirror, the certificate and what to do",
                            not chk.get("ok") and srv.endpoint in error and re.search(UNTRUSTED_CA_ERROR, error) is not None,
                            f"{json.dumps(chk)[:600]} expected /{UNTRUSTED_CA_ERROR}/", row=CA_ROW)
            inst = s.invoke("igni_install_update")
            error = inst.get("error", "")
            ctx.proof.check(f"{label}: igni_install_update is refused the same way",
                            not inst.get("ok") and re.search(UNTRUSTED_CA_ERROR, error) is not None,
                            json.dumps(inst)[:600], row=CA_ROW)
            prompt = prompt or s.prompt()
        s.shot("untrusted-ca")
        refused = srv.tls_failures_since(tls_mark)
        hits = srv.since(mark)
    ctx.proof.check(f"{label}: the app tried the mirror and its TLS refused the issuer (unknown_ca)",
                    bool(refused) and all(re.search(UNKNOWN_CA_ALERT, r["reason"], re.I) for r in refused),
                    json.dumps(refused)[:600], row=CA_ROW)
    ctx.proof.check(f"{label}: no HTTP request got through to the mirror", not hits, json.dumps(hits)[:300], row=CA_ROW)
    ctx.proof.check(f"{label}: no update banner", not prompt, json.dumps(prompt)[:300], row=CA_ROW)


def refused_install(ctx: Ctx, s: Session, mode: str, label: str, expect: str) -> None:
    """The banner offers B; Install is pressed; the payload is refused, and
    A stays installed and running."""
    srv = ctx.server
    srv.set_mode(mode)
    before = ctx.installed.state()
    mark = srv.mark()
    try:
        if s.driver is not None:
            s.dismiss()
            s.reload()
        else:
            s.start()
        if not s.connected(300):
            ctx.proof.check(f"{label}: the app connects to its backend", False, s.loading_error()[:400])
            return
        prompt = s.wait_prompt(120)
        ctx.proof.check(f"{label}: the startup check shows the update banner offering {ctx.version_b}",
                        bool(prompt) and ctx.version_b in (prompt or {}).get("text", ""), json.dumps(prompt)[:400])
        if not prompt:
            return
        pid = s.app_pid
        clicked = time.time()
        s.click_install()
        after_click = wait_for(lambda: (p := s.prompt()) and p.get("error") and p, 180, 1.5)
        s.shot(f"{mode}-refused")
        hits = srv.since(mark)
        error = (after_click or {}).get("error", "")
        ctx.proof.check(f"{label}: Install is refused and the banner says why", re.search(expect, error, re.I) is not None,
                        f"error={error[:300]!r} expected /{expect}/")
        fetched = [h["path"].rsplit("/", 1)[-1] for h in downloads(hits) if h["t"] >= clicked]
        ctx.proof.check(f"{label}: the app downloaded its own installer's payload ({srv.own_asset}) before refusing it",
                        bool(fetched) and set(fetched) == {srv.own_asset}, json.dumps(downloads(hits))[:300])
        after = ctx.installed.state()
        ctx.proof.check(f"{label}: what is installed is still A", after == before,
                        f"before={json.dumps(before)[:200]} after={json.dumps(after)[:200]}")
        others = [describe(p) for p in app_processes(clicked) if p.pid != pid]
        ctx.proof.check(f"{label}: the app is still running and did not relaunch", alive(pid) and not others,
                        f"pid {pid} alive={alive(pid)} new={json.dumps(others)[:200]}")
        if s.driver is not None:
            v = s.version()
            ctx.proof.check(f"{label}: the running app still reports version {ctx.version_a}", v.get("value") == ctx.version_a, json.dumps(v))
    finally:
        if s.driver is None:
            s.stop()


def policy_off(ctx: Ctx, s: Session) -> None:
    """``update_check_ttl: 0`` with the endpoint configured: no request at
    all, and Install is refused before the network (R628 owns the policy
    matrix; this is the one check R627 needs)."""
    srv = ctx.server
    mark = srv.mark()
    if not s.connected(300):
        ctx.proof.check("policy off: the app connects to its backend", False, s.loading_error()[:400])
        return
    time.sleep(20)  # the startup check, had the policy allowed one
    prompt = s.prompt()
    detail = {}
    if s.driver is not None:
        detail["check"] = s.invoke("igni_check_update")
        detail["install"] = s.invoke("igni_install_update")
        s.reload()
        s.connected(120)
        time.sleep(10)
        prompt = prompt or s.prompt()
        ctx.proof.check("policy off: igni_check_update answers checks_disabled without asking",
                        (detail["check"].get("value") or {}).get("checks_disabled") is True, json.dumps(detail["check"])[:300])
        ctx.proof.check("policy off: igni_install_update is refused with the policy's reason",
                        not detail["install"].get("ok") and "update_check_ttl" in detail["install"].get("error", ""),
                        json.dumps(detail["install"])[:300])
    hits = srv.since(mark)
    ctx.proof.check("policy off: no update banner", not prompt, json.dumps(prompt)[:200])
    ctx.proof.check("policy off: no request reaches the configured endpoint", not hits, json.dumps(hits)[:300])


def good_update(ctx: Ctx, s: Session) -> dict | None:
    """The genuine payload: downloaded, verified, installed, relaunched."""
    srv = ctx.server
    srv.set_mode("good")
    mark = srv.mark()
    if s.driver is not None:
        s.dismiss()
        s.reload()
    else:
        s.start()
    if not s.connected(300):
        ctx.proof.check("genuine update: the app connects to its backend", False, s.loading_error()[:400])
        return None
    prompt = s.wait_prompt(120)
    ctx.proof.check(f"genuine update: the banner offers {ctx.version_b} over {ctx.version_a}",
                    bool(prompt) and ctx.version_b in (prompt or {}).get("text", ""), json.dumps(prompt)[:400])
    if not prompt:
        return None
    if s.driver is not None:
        chk = s.invoke("igni_check_update")
        ctx.proof.info("genuine update: igni_check_update before installing", json.dumps(chk)[:400])
    s.shot("good-banner")
    before = ctx.installed.state()
    pid = s.app_pid
    clicked = time.time()
    s.click_install()

    # Windows: the plugin starts the installer and exits; the installer
    # relaunches the app. Linux and macOS: the shell swaps the bundle in
    # place and restarts itself.
    exited = wait_for(lambda: not alive(pid), 300, 1)
    ctx.proof.check("genuine update: version A exits to make way", bool(exited), f"pid {pid}")

    def relaunched():
        fresh = [p for p in app_processes(clicked) if p.pid != pid]
        return fresh

    new = wait_for(relaunched, 300, 1) or []
    hits = srv.since(mark)
    fetched = [h["path"].rsplit("/", 1)[-1] for h in downloads(hits) if h["t"] >= clicked]
    ctx.proof.check(f"genuine update: Install fetched this install's own entry, {srv.own_asset}, and nothing else",
                    bool(fetched) and set(fetched) == {srv.own_asset}, json.dumps(downloads(hits))[:300])
    state = wait_for(lambda: (st := ctx.installed.state()) and ctx.installed.matches_b(st)[0] and st, 300, 2) or ctx.installed.state()
    ok, why = ctx.installed.matches_b(state)
    ctx.proof.check(f"genuine update: what is installed is now B ({ctx.version_b})", ok, why)
    ctx.proof.check("genuine update: the installed files changed", state != before,
                    f"before={json.dumps(before)[:200]} after={json.dumps(state)[:200]}")
    described = [describe(p) for p in new]
    ctx.proof.check("genuine update: the app relaunched itself after installing", bool(new), json.dumps(described)[:600])
    (ctx.out / "relaunched.json").write_text(json.dumps(described, indent=2), encoding="utf-8")
    if IS_LINUX and new:
        # The relaunch is the AppImage at the installed path, which now holds B.
        envs = []
        for p in new:
            try:
                envs.append(p.environ().get("APPIMAGE", ""))
            except Exception:
                pass
        ctx.proof.check("genuine update: the relaunched process runs from the installed AppImage path",
                        str(ctx.installed.target) in envs, f"APPIMAGE={envs}")
    if IS_WIN and new:
        exes = [d.get("exe", "") for d in described]
        ctx.proof.check("genuine update: the relaunched process is the installed program",
                        any(Path(e).resolve() == Path(ctx.installed.exe).resolve() for e in exes if e), json.dumps(exes))
    if IS_MAC and new:
        exes = [d.get("exe", "") for d in described]
        ctx.proof.check("genuine update: the relaunched process runs from the installed bundle",
                        any(e.startswith(str(ctx.installed.target)) for e in exes), json.dumps(exes))
    return {"clicked": clicked, "relaunched": described}


def verify_b_runs(ctx: Ctx) -> None:
    """A fresh launch from the installed location: version B, and no update
    offered any more."""
    srv = ctx.server
    mark = srv.mark()
    with Session(ctx, "after-update") as s:
        ok = s.connected(300)
        ctx.proof.check("after the update: the installed app starts and connects", ok, s.loading_error()[:300])
        time.sleep(15)
        prompt = s.prompt()
        hits = srv.since(mark)
        if s.driver is not None:
            v = s.version()
            ctx.proof.check(f"after the update: the running app reports version {ctx.version_b}", v.get("value") == ctx.version_b, json.dumps(v))
            chk = s.invoke("igni_check_update")
            ctx.proof.check("after the update: igni_check_update finds nothing newer",
                            chk.get("ok") and (chk.get("value") or {}).get("available") is False, json.dumps(chk)[:300])
        ctx.proof.check("after the update: the startup check asked the endpoint and offered nothing",
                        bool(manifests(hits)) and not downloads(hits) and not prompt,
                        f"prompt={json.dumps(prompt)[:150]} hits={json.dumps(hits)[:200]}")
        s.shot("after-update")


def run(ctx: Ctx) -> None:
    proof = ctx.proof
    ca, cert, key = make_tls(ctx.work)
    map_mirror_name()
    b = ctx.stage / ctx.files["b"]
    ctx.server = UpdateServer(ctx, cert, key)
    ctx.server.log_to = ctx.out / "endpoint-requests.json"
    good = ctx.server.manifests["good"]
    proof.info("setup", f"endpoint {ctx.server.endpoint}; A={ctx.version_a} B={ctx.version_b}; this install's payload "
                        f"{ctx.server.own_asset} ({b.stat().st_size} bytes); latest.json by scripts/latest-json.mjs, keys "
                        f"{sorted(good['platforms'])}")
    keys = {p.name: p.read_text() for p in (ctx.stage / "keys").glob("*-binary-keys.json")}
    proof.info("setup: which updater key each build carries", json.dumps(keys))
    threading.Thread(target=http.server.ThreadingHTTPServer(("127.0.0.1", ctx.stub_port), StubModel).serve_forever,
                     daemon=True).start()
    ctx.prepare_project()

    ctx.installed.install_a()
    proof.info("A installed", f"{ctx.installed.exe}: {json.dumps(ctx.installed.state())[:300]}")
    endpoint_cfg = f"update_endpoint: {ctx.server.endpoint}\n"

    # 0. The corporate CA mirror, its CA in no trust store yet (F13); then
    #    the CA goes into the OS store, as IT installs a company CA, and
    #    every step below goes through that trust.
    mirror_name_and_certificate(ctx, ca)
    ctx.write_user_config(endpoint_cfg)
    untrusted_mirror(ctx)
    trust_ca(ca)
    proof.info("corporate CA trusted", f"{ca.name} added to the OS trust store; the mirror stays {ctx.server.endpoint}",
               row=CA_ROW)

    # 1. Policy off, the endpoint configured all the same.
    ctx.write_user_config(f"update_check_ttl: 0\nupdate_endpoint: {ctx.server.endpoint}\n")
    if ctx.webdriver:
        s = Session(ctx, "as-version-a")
        try:
            s.start()
            v = wait_for(lambda: (r := s.version()) and r.get("ok") and r, 60) or {}
            proof.check(f"A runs and reports version {ctx.version_a}", v.get("value") == ctx.version_a, json.dumps(v))
            policy_off(ctx, s)
            # 2–4 in the same launch: each reload re-runs the startup check,
            # and the shell reads the policy afresh on every check.
            ctx.write_user_config(endpoint_cfg)
            refused_install(ctx, s, "wrongkey", "payload signed by another key", WRONG_KEY_ERROR)
            refused_install(ctx, s, "tampered", "tampered payload", TAMPERED_ERROR)
            good_update(ctx, s)
        finally:
            s.stop()
    else:
        s = Session(ctx, "policy-off")
        with s:
            policy_off(ctx, s)
        ctx.write_user_config(endpoint_cfg)
        refused_install(ctx, Session(ctx, "wrongkey"), "wrongkey", "payload signed by another key", WRONG_KEY_ERROR)
        refused_install(ctx, Session(ctx, "tampered"), "tampered", "tampered payload", TAMPERED_ERROR)
        s = Session(ctx, "genuine")
        try:
            good_update(ctx, s)
        finally:
            s.stop()
    verify_b_runs(ctx)
    ctx.server.save(ctx.out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, help="the directory updater_builds.sh filled")
    ap.add_argument("--kind", required=True, choices=["appimage", "msi", "nsis", "app"])
    ap.add_argument("--core", required=True, help="igni-core checkout with a synced .venv")
    ap.add_argument("--tauri-driver")
    ap.add_argument("--native-driver")
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--latest-json-script", default=str(Path(__file__).resolve().parents[3] / "scripts" / "latest-json.mjs"),
                    help="the release's latest.json assembler")
    a = ap.parse_args()
    ctx = Ctx(a)
    try:
        run(ctx)
    except Exception as exc:
        ctx.proof.check("the proof ran to the end", False, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}")
    finally:
        if getattr(ctx, "server", None):
            ctx.server.save(ctx.out)
    ctx.proof.flush()
    statuses: dict[str, int] = {}
    for r in ctx.proof.results:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    print(json.dumps(statuses))
    return 1 if ctx.proof.failed() else 0


if __name__ == "__main__":
    sys.exit(main())
