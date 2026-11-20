#!/usr/bin/python3
"""The Linux half of the desktop proof's native driving: the app's GTK menu
bar and message dialogs, read and worked through AT-SPI, the accessibility
bus every GTK window publishes itself on.

Run with the system Python (``/usr/bin/python3``), which is the one with
``gi`` and the Atspi typelib (``python3-gi``, ``gir1.2-atspi-2.0``);
``desktop_proof.py`` calls it as a subprocess and reads one JSON object
from its last line of output.

    atspi_ui.py menus  --pid PID
    atspi_ui.py click  --pid PID --menu File --item "Restart Backend" [--window-name TEXT]
    atspi_ui.py dialog --pid PID --title "Backend Diagnostics" [--keep] [--timeout 20]
    atspi_ui.py pick   --pid PID --path /some/folder [--timeout 20]

Nothing here clicks by coordinates: a menu item is activated through its
own accessible action, the one a screen reader uses, so the shell gets the
same ``activate`` a mouse click would give it.
"""

import argparse
import json
import subprocess
import sys
import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

# Web content is a large tree and holds nothing this helper looks for.
PRUNE = {"document web", "document frame"}


def emit(obj):
    print(json.dumps(obj), flush=True)


def role(node):
    try:
        return node.get_role_name() or ""
    except Exception:
        return ""


def name(node):
    try:
        return node.get_name() or ""
    except Exception:
        return ""


def children(node):
    try:
        count = node.get_child_count()
    except Exception:
        return []
    out = []
    for i in range(count):
        try:
            child = node.get_child_at_index(i)
        except Exception:
            continue
        if child is not None:
            out.append(child)
    return out


def walk(node, depth=0, limit=60):
    yield node
    if depth >= limit or role(node) in PRUNE:
        return
    for child in children(node):
        yield from walk(child, depth + 1, limit)


def sensitive(node):
    try:
        return node.get_state_set().contains(Atspi.StateType.SENSITIVE)
    except Exception:
        return False


def app_for(pid, timeout):
    """The accessible application of process ``pid``, once it registers."""
    end = time.time() + timeout
    while time.time() < end:
        desktop = Atspi.get_desktop(0)
        for app in children(desktop):
            try:
                if app.get_process_id() == pid:
                    return app
            except Exception:
                continue
        time.sleep(0.5)
    return None


def windows(app):
    return children(app)


def menu_bars(app, window_name=None):
    bars = []
    for win in windows(app):
        if window_name and window_name not in name(win):
            continue
        for node in walk(win, limit=12):
            if role(node) == "menu bar":
                bars.append((win, node))
    return bars


def describe_bar(bar):
    menus = {}
    for menu in children(bar):
        items = []
        for item in children(menu):
            items.append(
                {
                    "name": name(item),
                    "role": role(item),
                    "enabled": sensitive(item),
                }
            )
        menus[name(menu)] = items
    return menus


def do_action(node):
    try:
        iface = node.get_action_iface()
        if iface is not None:
            return bool(iface.do_action(0))
    except Exception:
        pass
    try:
        return bool(Atspi.Action.do_action(node, 0))
    except Exception as exc:  # pragma: no cover - reported to the caller
        raise RuntimeError(f"no action on {role(node)} {name(node)!r}: {exc}")


def cmd_menus(args):
    app = app_for(args.pid, args.timeout)
    if app is None:
        return emit({"ok": False, "error": f"no accessible app for pid {args.pid}"})
    bars = menu_bars(app, args.window_name)
    if not bars:
        return emit({"ok": False, "error": "no menu bar in any window"})
    out = []
    for win, bar in bars:
        out.append({"window": name(win), "menus": describe_bar(bar)})
    emit({"ok": True, "app": name(app), "bars": out})


def cmd_click(args):
    app = app_for(args.pid, args.timeout)
    if app is None:
        return emit({"ok": False, "error": f"no accessible app for pid {args.pid}"})
    bars = menu_bars(app, args.window_name)
    for win, bar in bars:
        for menu in children(bar):
            if name(menu) != args.menu:
                continue
            for item in children(menu):
                if name(item) == args.item:
                    if not sensitive(item):
                        return emit({"ok": False, "error": f"{args.item!r} is disabled"})
                    done = do_action(item)
                    return emit({"ok": done, "window": name(win)})
    emit({"ok": False, "error": f"no item {args.menu} > {args.item}"})


def dialog_nodes(app, title):
    for win in windows(app):
        if role(win) in ("alert", "dialog", "frame", "file chooser") and title in name(win):
            return win
    return None


def cmd_dialog(args):
    app = app_for(args.pid, args.timeout)
    if app is None:
        return emit({"ok": False, "error": f"no accessible app for pid {args.pid}"})
    end = time.time() + args.timeout
    win = None
    while time.time() < end and win is None:
        win = dialog_nodes(app, args.title)
        if win is None:
            time.sleep(0.5)
    if win is None:
        names = [f"{role(w)}:{name(w)}" for w in windows(app)]
        return emit({"ok": False, "error": f"no dialog titled {args.title!r}", "windows": names})
    labels = [name(n) for n in walk(win) if role(n) == "label" and name(n)]
    dismissed = False
    if not args.keep:
        for node in walk(win):
            if role(node) == "push button" and name(node).replace("_", "") in ("OK", "Ok", "Close"):
                dismissed = do_action(node)
                break
    emit({"ok": True, "title": name(win), "role": role(win), "text": "\n".join(labels), "dismissed": dismissed})


def xdotool(*argv):
    return subprocess.run(["xdotool", *argv], capture_output=True, text=True, timeout=30)


def cmd_pick(args):
    """Choose ``--path`` in the GTK folder chooser the app has open."""
    app = app_for(args.pid, args.timeout)
    if app is None:
        return emit({"ok": False, "error": f"no accessible app for pid {args.pid}"})
    end = time.time() + args.timeout
    chooser = None
    while time.time() < end and chooser is None:
        for win in windows(app):
            if role(win) in ("file chooser", "dialog"):
                chooser = win
                break
        if chooser is None:
            time.sleep(0.5)
    if chooser is None:
        return emit({"ok": False, "error": "no folder chooser appeared"})
    title = name(chooser)
    found = xdotool("search", "--sync", "--limit", "1", "--name", title)
    wid = found.stdout.split()[0] if found.stdout.split() else None
    if wid:
        xdotool("windowactivate", "--sync", wid)
    # Ctrl+L opens the location entry, which takes a typed path.
    xdotool("key", "--clearmodifiers", "ctrl+l")
    time.sleep(0.8)
    entry = None
    for node in walk(chooser):
        if role(node) == "text":
            try:
                if node.get_state_set().contains(Atspi.StateType.EDITABLE) and node.get_state_set().contains(
                    Atspi.StateType.SHOWING
                ):
                    entry = node
                    break
            except Exception:
                continue
    if entry is None:
        return emit({"ok": False, "error": "no location entry in the chooser", "title": title})
    try:
        Atspi.EditableText.set_text_contents(entry, args.path)
    except Exception:
        entry.get_editable_text_iface().set_text_contents(args.path)
    time.sleep(0.5)
    pressed = None
    for node in walk(chooser):
        if role(node) == "push button" and name(node).replace("_", "") in ("Select", "Open", "OK"):
            pressed = name(node)
            do_action(node)
            break
    if pressed is None:
        xdotool("key", "Return")
    end = time.time() + 10
    while time.time() < end:
        if dialog_nodes(app, title) is None:
            return emit({"ok": True, "title": title, "pressed": pressed})
        time.sleep(0.5)
    emit({"ok": False, "error": "the chooser stayed open", "title": title, "pressed": pressed})


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    for cmd in ("menus", "click", "dialog", "pick"):
        p = sub.add_parser(cmd)
        p.add_argument("--pid", type=int, required=True)
        p.add_argument("--timeout", type=float, default=20)
        p.add_argument("--window-name", default=None)
        if cmd == "click":
            p.add_argument("--menu", required=True)
            p.add_argument("--item", required=True)
        if cmd == "dialog":
            p.add_argument("--title", required=True)
            p.add_argument("--keep", action="store_true")
        if cmd == "pick":
            p.add_argument("--path", required=True)
    args = parser.parse_args()
    try:
        {"menus": cmd_menus, "click": cmd_click, "dialog": cmd_dialog, "pick": cmd_pick}[args.cmd](args)
    except Exception as exc:
        emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    sys.exit(main())
