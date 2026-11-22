#!/usr/bin/env python3
"""A logging HTTP forward proxy for igni's enterprise E2E scenarios.

Stands in for a corporate egress proxy: a client configured with
``HTTP_PROXY``/``HTTPS_PROXY`` sends absolute-form requests (``POST
http://host:port/path``) and ``CONNECT host:port`` tunnels here, and every
one is appended to ``--log`` as a JSON line before it is forwarded. Host
names ending in ``.e2e.test`` resolve to 127.0.0.1, so a test can name a
model host that only exists through the proxy: a request that bypassed it
could not resolve the name at all.

Standard library only. Prints ``{"status": "ready", "port": N}`` when
listening.
"""

from __future__ import annotations

import argparse
import json
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

_lock = threading.Lock()


def resolve(host: str) -> str:
    return "127.0.0.1" if host.endswith(".e2e.test") else host


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        pass

    def _record(self, method: str, target: str) -> None:
        with _lock, open(self.server.log_path, "a", encoding="utf-8") as fh:  # type: ignore[attr-defined]
            fh.write(json.dumps({"at": time.time(), "method": method, "target": target}) + "\n")

    def do_CONNECT(self) -> None:  # noqa: N802
        self._record("CONNECT", self.path)
        host, _, port = self.path.rpartition(":")
        try:
            upstream = socket.create_connection((resolve(host), int(port)), timeout=30)
        except OSError as exc:
            self.send_error(502, f"cannot reach {self.path}: {exc}")
            return
        self.send_response(200, "Connection established")
        self.end_headers()
        self._pipe(self.connection, upstream)

    def _forward(self) -> None:
        self._record(self.command, self.path)
        parts = urlsplit(self.path)
        if not parts.hostname:
            self.send_error(400, "absolute-form request expected")
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        upstream = socket.create_connection((resolve(parts.hostname), parts.port or 80), timeout=60)
        path = parts.path + (f"?{parts.query}" if parts.query else "")
        lines = [f"{self.command} {path or '/'} HTTP/1.1"]
        for key, value in self.headers.items():
            if key.lower() in ("proxy-connection", "connection", "keep-alive"):
                continue
            lines.append(f"{key}: {value}")
        lines.append("Connection: close")
        upstream.sendall(("\r\n".join(lines) + "\r\n\r\n").encode() + body)
        self.close_connection = True
        # Relay the response as is, to the end of the upstream stream.
        while True:
            chunk = upstream.recv(65536)
            if not chunk:
                break
            self.wfile.write(chunk)
            self.wfile.flush()
        upstream.close()

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _forward  # noqa: N815

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        socks = [a, b]
        try:
            while True:
                ready, _, _ = select.select(socks, [], [], 60)
                if not ready:
                    return
                for s in ready:
                    data = s.recv(65536)
                    if not data:
                        return
                    (b if s is a else a).sendall(data)
        except OSError:
            return
        finally:
            b.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--log", required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Proxy)
    server.daemon_threads = True
    server.log_path = args.log  # type: ignore[attr-defined]
    print(json.dumps({"status": "ready", "port": server.server_address[1]}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
