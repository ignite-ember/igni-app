#!/usr/bin/env python3
"""A scripted, OpenAI-compatible model server for igni's end-to-end suites.

The live browser specs and the desktop E2E jobs need a model that answers,
and CI must never hold a real API key. This server is that model: it speaks
the part of the OpenAI Chat Completions API igni-core's ``openai_like``
provider uses (``POST /v1/chat/completions``, streamed or not, with tool
calls, and ``GET /v1/models``), and it answers from a script instead of
from weights, so every run gets the same reply.

The script is read from the **last user message**, so a test controls the
model by what it types:

``Reply with exactly WORD``
    The reply is ``WORD``.
``[[tool NAME {json args}]]``
    The first answer is a call to the tool ``NAME`` with those arguments;
    once the tool's result is in the conversation, the answer is the reply
    the rest of the message asks for. Several ``[[tool ...]]`` markers run
    in order, one per turn of the agent loop.
``[[slow MS]]``
    Every streamed chunk waits ``MS`` milliseconds (cancel tests).
``[[lines N]]``
    The reply is ``N`` numbered lines (long transcripts, scrolling).
``[[big N]]``
    The reply is one line of ``N`` characters (oversized content).
``[[b64 BASE64]]``
    The reply is that text, decoded (hostile content: script tags, links,
    oversized markdown — anything a test wants the model to "say").
``[[status CODE]]``
    The request fails with HTTP ``CODE`` (provider errors).
``[[hang]]``
    The request never answers (until the client gives up or cancels).
``[[die]]``
    The server sends half a stream, then exits the process: the model
    vanishing mid-answer.

Without a directive, a message that mentions a "shell tool" gets one
``run_shell_command`` call (``ls``) first, and every reply ends with any
``TKN...`` markers the message holds, so the existing live specs'
"echo this token" checks work unchanged. "Count ... from 1 to N" streams
the numbers slowly, so there is a run in flight to cancel or queue behind.

Every request is appended as one JSON line to ``--log`` when given, so a
test can assert what the backend actually sent the model.

Usage::

    python scripted_model.py --port 0 --port-file /tmp/model.port

prints ``{"status": "ready", "port": N}`` on stdout once listening.
Standard library only: it runs from any Python 3.10+, on every runner.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MODEL_ID = "e2e-scripted"

_TOOL = re.compile(r"\[\[tool\s+([A-Za-z0-9_\-.]+)\s*(\{.*?\})?\s*\]\]", re.S)
_SLOW = re.compile(r"\[\[slow\s+(\d+)\]\]")
_LINES = re.compile(r"\[\[lines\s+(\d+)\]\]")
_BIG = re.compile(r"\[\[big\s+(\d+)\]\]")
_B64 = re.compile(r"\[\[b64\s+([A-Za-z0-9+/=_\-]+)\]\]")
_STATUS = re.compile(r"\[\[status\s+(\d{3})\]\]")
_EXACT = re.compile(r"Reply with exactly\s+(\S+?)(?:[.\s]|$)")
_COUNT = re.compile(r"Count (?:slowly )?from 1 to (\d+)", re.I)
_TOKENS = re.compile(r"\bTKN[A-Z0-9]+\b")

_log_lock = threading.Lock()


def _text(content: Any) -> str:
    """A message's text, whether ``content`` is a string or a list of parts."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "\n".join(parts)
    return ""


def _last_user(messages: list[dict[str, Any]]) -> tuple[int, str]:
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            return i, _text(messages[i].get("content"))
    return -1, ""


def _tool_names(body: dict[str, Any]) -> list[str]:
    names = []
    for tool in body.get("tools") or []:
        fn = tool.get("function") if isinstance(tool, dict) else None
        if isinstance(fn, dict) and fn.get("name"):
            names.append(str(fn["name"]))
    return names


def plan_reply(body: dict[str, Any]) -> dict[str, Any]:
    """What to answer: ``{"tool": (name, args)}`` or ``{"text": str}``, plus pacing."""
    messages = body.get("messages") or []
    idx, user = _last_user(messages)
    # Tool calls the assistant already made since that user message.
    calls_made = sum(
        len(m.get("tool_calls") or [])
        for m in messages[idx + 1 :]
        if m.get("role") == "assistant"
    )
    slow = _SLOW.search(user)
    plan: dict[str, Any] = {"delay": int(slow.group(1)) / 1000 if slow else 0.0}

    status = _STATUS.search(user)
    if status:
        plan["status"] = int(status.group(1))
        return plan
    if "[[hang]]" in user:
        plan["hang"] = True
        return plan
    if "[[die]]" in user:
        plan["die"] = True

    tools = [(m.group(1), m.group(2) or "{}") for m in _TOOL.finditer(user)]
    if not tools and re.search(r"shell tool", user, re.I):
        tools = [("run_shell_command", json.dumps({"command": "ls"}))]
    if calls_made < len(tools):
        name, args = tools[calls_made]
        offered = _tool_names(body)
        if not offered:
            # A side request with no tools (a title, an explanation of a
            # pending call): answer in words, never with a call.
            plan["text"] = "Scripted reply."
            return plan
        if name not in offered:
            plan["text"] = (
                f"scripted model: the tool {name!r} was not offered; "
                f"offered: {', '.join(sorted(offered))}"
            )
            return plan
        plan["tool"] = (name, args)
        return plan

    b64 = _B64.search(user)
    lines = _LINES.search(user)
    exact = _EXACT.search(user)
    count = _COUNT.search(user)
    tokens = list(dict.fromkeys(_TOKENS.findall(user)))
    big = _BIG.search(user)
    if big:
        text = "A" * int(big.group(1))
    elif b64:
        text = base64.b64decode(b64.group(1) + "===").decode("utf-8", "replace")
    elif lines:
        text = "\n".join(f"Line {i} of the scripted reply." for i in range(1, int(lines.group(1)) + 1))
    elif exact:
        text = exact.group(1)
    elif count:
        n = int(count.group(1))
        text = "\n".join(str(i) for i in range(1, n + 1))
        plan["delay"] = plan["delay"] or 0.25
    elif idx < 0:
        text = "Scripted reply."
    else:
        text = "Scripted reply."
    for token in tokens:
        if token not in text:
            text = f"{text}\n{token}"
    plan["text"] = text
    return plan


def _chunks(text: str) -> list[str]:
    """Split a reply into streamed pieces: a line or a few words each."""
    out: list[str] = []
    for line in text.splitlines(keepends=True):
        words = re.findall(r"\S+\s*|\s+", line)
        for i in range(0, len(words), 4):
            piece = "".join(words[i : i + 4])
            # An unbroken 2 MB word still streams, in 16 KB frames.
            out.extend(piece[j : j + 16384] for j in range(0, len(piece), 16384))
    return out or [""]


class Handler(BaseHTTPRequestHandler):
    server_version = "igni-scripted-model/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quiet by default
        if os.environ.get("SCRIPTED_MODEL_VERBOSE"):
            sys.stderr.write("scripted-model: " + (fmt % args) + "\n")

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 — http.server's naming
        if self.path.rstrip("/").endswith("/models"):
            self._json(200, {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "e2e"}]})
        elif self.path == "/health":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": {"message": f"no route {self.path}"}})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            self._json(400, {"error": {"message": "body is not JSON"}})
            return
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._json(404, {"error": {"message": f"no route {self.path}"}})
            return
        plan = plan_reply(body)
        self._record(body, plan)
        if "status" in plan:
            self._json(plan["status"], {"error": {"message": f"scripted failure {plan['status']}", "type": "scripted"}})
            return
        if plan.get("hang"):
            self._hang(bool(body.get("stream")))
            return
        if body.get("stream"):
            self._stream(body, plan)
        else:
            self._whole(plan)

    def _hang(self, stream: bool) -> None:
        """Never answer. A stream sends keep-alive comments, so a client that
        gives up is noticed (the write fails) and the thread ends."""
        try:
            if stream:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
            for _ in range(1200):
                time.sleep(0.5)
                if stream:
                    self.wfile.write(b": still thinking\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def _record(self, body: dict[str, Any], plan: dict[str, Any]) -> None:
        log = self.server.log_path  # type: ignore[attr-defined]
        if not log:
            return
        entry = {
            "at": time.time(),
            "model": body.get("model"),
            "stream": bool(body.get("stream")),
            "messages": body.get("messages"),
            "tools": _tool_names(body),
            "plan": {k: (list(v) if isinstance(v, tuple) else v) for k, v in plan.items()},
            "headers": {k: v for k, v in self.headers.items() if k.lower() not in ("authorization", "x-api-key")},
        }
        with _log_lock, open(log, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def _whole(self, plan: dict[str, Any]) -> None:
        message: dict[str, Any] = {"role": "assistant", "content": None}
        finish = "stop"
        if "tool" in plan:
            name, args = plan["tool"]
            message["tool_calls"] = [
                {"id": f"call_{int(time.time() * 1000)}", "type": "function", "function": {"name": name, "arguments": args}}
            ]
            finish = "tool_calls"
        else:
            message["content"] = plan["text"]
        self._json(
            200,
            {
                "id": f"chatcmpl-{int(time.time() * 1000)}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": MODEL_ID,
                "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
            },
        )

    def _stream(self, body: dict[str, Any], plan: dict[str, Any]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        cid = f"chatcmpl-{int(time.time() * 1000)}"

        def send(delta: dict[str, Any], finish: str | None = None, usage: dict[str, int] | None = None) -> None:
            chunk: dict[str, Any] = {
                "id": cid,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": MODEL_ID,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}] if usage is None else [],
            }
            if usage is not None:
                chunk["usage"] = usage
            self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
            self.wfile.flush()

        try:
            send({"role": "assistant", "content": ""})
            if "tool" in plan:
                name, args = plan["tool"]
                send({"tool_calls": [{"index": 0, "id": f"call_{cid}", "type": "function", "function": {"name": name, "arguments": ""}}]})
                send({"tool_calls": [{"index": 0, "function": {"arguments": args}}]})
                send({}, "tool_calls")
            else:
                pieces = _chunks(plan["text"])
                for n, piece in enumerate(pieces):
                    if plan["delay"]:
                        time.sleep(plan["delay"])
                    send({"content": piece})
                    if plan.get("die") and n >= len(pieces) // 2:
                        self.wfile.flush()
                        os._exit(3)
                send({}, "stop")
            if (body.get("stream_options") or {}).get("include_usage"):
                send({}, usage={"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # The backend cancelled the run: exactly what a cancel test wants.
            return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--port-file", help="write the bound port here")
    parser.add_argument("--log", help="append every request as a JSON line here")
    parser.add_argument("--tls-cert", help="serve HTTPS with this certificate chain (PEM)")
    parser.add_argument("--tls-key", help="the certificate's private key (PEM)")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    server.log_path = args.log  # type: ignore[attr-defined]
    if args.tls_cert:
        import ssl

        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.tls_cert, args.tls_key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    port = server.server_address[1]
    if args.port_file:
        tmp = args.port_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(str(port))
        os.replace(tmp, args.port_file)
    print(json.dumps({"status": "ready", "port": port}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
