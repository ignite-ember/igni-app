
// The shell sends menu, link and fullscreen events to one window
// (events.rs ``ShellEvent::target``). A global ``event.listen`` hears
// events sent to every window, so each window listens on its own.
//
// The listeners are registered first, and they need no DOM: Windows
// injects this script at document start, where the document's root
// element does not exist yet. An unguarded ``document.documentElement``
// throws there, and the throw aborts the whole script — so the window
// would never register its listeners and would never hear the shell's
// link.
//
// What was registered, and for which label, is kept on the window: a
// step that fails on the way a link takes has to say whether the
// listener was heard at all.
(function () {
  const trace = { label: null, registered: [], failed: [], fired: [] };
  window.__igniListen = trace;

  function listenHere(name, handler) {
    const ww = window.__TAURI__.webviewWindow;
    const here = ww && ww.getCurrentWebviewWindow ? ww.getCurrentWebviewWindow() : null;
    trace.label = here ? here.label : null;
    const promise = here
      ? here.listen(name, handler)
      : window.__TAURI__.event.listen(name, handler);
    promise.then(
      () => trace.registered.push(name),
      (e) => trace.failed.push(`${name}: ${e}`),
    );
    return promise;
  }

  function listenToTheShell() {
    if (!window.__TAURI__ || !window.__TAURI__.event) return false;
    listenHere('igni-menu', (e) => {
      trace.fired.push('igni-menu');
      const id = e && e.payload;
      if (typeof id !== 'string') return;
      window.dispatchEvent(new CustomEvent('igni-host', {
        detail: { type: 'igni:menu', payload: { id } }
      }));
    });
    // An igni:// link is waiting for this window (deep_link.rs); the web
    // UI takes it with ``igni_take_open_link``.
    listenHere('igni-open-link', () => {
      trace.fired.push('igni-open-link');
      window.dispatchEvent(new CustomEvent('igni-host', {
        detail: { type: 'igni:open-link' }
      }));
    });
    // Mirror native fullscreen state into a ``data-fullscreen`` attr
    // on ``<html>`` so CSS can collapse the header gutter when the
    // OS hides our traffic-light cluster behind the slide-down panel.
    listenHere('igni-fullscreen', (e) => {
      trace.fired.push('igni-fullscreen');
      const on = !!(e && e.payload);
      const html = document.documentElement;
      if (html) html.dataset.fullscreen = on ? 'true' : 'false';
    });
    return true;
  }

  if (!listenToTheShell()) {
    // The API is not there yet: wait for it rather than leaving the
    // window deaf.
    let tries = 0;
    const timer = setInterval(() => {
      if (listenToTheShell() || ++tries > 200) clearInterval(timer);
    }, 50);
  }
})();

// Stamp `data-host` and `data-platform` on `<html>` for the
// host-aware CSS. The root element does not exist yet when the script
// runs at document start (Windows), so the stamp waits for it rather
// than insisting on it: a throw here would abort everything below.
(function () {
  function stamp() {
    const html = document.documentElement;
    if (!html) return false;
    html.dataset.host = 'tauri';
    html.dataset.platform = '__PLATFORM__';
    return true;
  }
  if (stamp()) return;
  document.addEventListener('DOMContentLoaded', stamp, { once: true });
  let tries = 0;
  const timer = setInterval(() => {
    if (stamp() || ++tries > 100) clearInterval(timer);
  }, 50);
})();

window.__IGNI_PICK_DIR__ = (start) =>
  window.__TAURI__.core.invoke('plugin:dialog|open', {
    options: {
      directory: true,
      multiple: false,
      defaultPath: start || undefined
    }
  });

function openExternalUrl(url) {
  return window.__TAURI__.core.invoke('plugin:opener|open_url', { url });
}

window.__IGNI_HOST__ = Object.assign(window.__IGNI_HOST__ || {}, {
  openFile: (path) => window.__TAURI__.core.invoke(
    'plugin:opener|open_path', { path }
  ),
  revealInFolder: (path) => window.__TAURI__.core.invoke(
    'plugin:opener|reveal_item_in_dir', { path }
  ),
  notify: (payload) => window.__TAURI__.core.invoke(
    'plugin:notification|notify',
    { options: { title: payload.title, body: payload.body || '' } }
  ),
  setAppTitle: (folder, org) => window.__TAURI__.core.invoke(
    'set_app_title', { folder, org }
  ),
  openUrl: openExternalUrl,
});

// Route http(s) and mailto links to the OS browser/mail client.
// Without this, anchor clicks navigate the whole WKWebView to the
// target URL (no top-level browser context exists), and
// ``window.open`` returns null — so links end up "opening inside
// the app". Intercept at the capture phase so we win against any
// React handlers, then hand off to the Tauri opener plugin.
(function () {
  function isExternal(href) {
    if (!href) return false;
    const lower = href.toLowerCase();
    return (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('mailto:') ||
      lower.startsWith('tel:')
    );
  }

  document.addEventListener(
    'click',
    (e) => {
      // Respect modifier-clicks the user may use to copy the link
      // address — let the default contextmenu / nothing-happens
      // behavior stand rather than firing the opener.
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        // Cmd/Ctrl-click still means "open in browser" for us;
        // there's no second window to route into. Fall through.
      }
      const path = e.composedPath ? e.composedPath() : [];
      let anchor = null;
      for (const node of path) {
        if (node && node.tagName === 'A' && node.href) {
          anchor = node;
          break;
        }
      }
      if (!anchor) {
        // Fallback for events whose composedPath is empty (rare).
        let n = e.target;
        while (n && n.tagName !== 'A') n = n.parentElement;
        if (n) anchor = n;
      }
      if (!anchor) return;
      const href = anchor.getAttribute('href') || anchor.href;
      if (!isExternal(href)) return;
      e.preventDefault();
      e.stopPropagation();
      openExternalUrl(href).catch((err) =>
        console.warn('[igni] open_url failed:', err)
      );
    },
    true
  );

  // ``window.open(url, …)`` is used by a few FE call sites
  // (update banner, install-CLI hint). In a Tauri webview the
  // default returns null and does nothing visible; route it to
  // the OS instead.
  const nativeOpen = window.open?.bind(window);
  window.open = function (url) {
    if (isExternal(url)) {
      openExternalUrl(url).catch((err) =>
        console.warn('[igni] window.open failed:', err)
      );
      return null;
    }
    return nativeOpen ? nativeOpen.apply(window, arguments) : null;
  };
})();

// Fullscreen-state mirror. Calls a custom Rust command that reads
// ``NSWindow.styleMask`` — the source of truth — and stamps the
// result onto ``<html data-fullscreen="true|false">``. Polls on
// every resize + every 300 ms so the attribute tracks ⌃⌘F toggles.
// Waits for ``window.__TAURI__`` to be populated (Tauri sets it up
// before init scripts run on modern versions, but the wait keeps
// us safe across versions).
(function () {
  function waitForInvoke(cb) {
    const tries = setInterval(() => {
      const i = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
      if (i) {
        clearInterval(tries);
        cb(i);
      }
    }, 30);
  }
  waitForInvoke((invoke) => {
    console.log('[igni] fullscreen-detection wired');
    const sync = async () => {
      try {
        const fs = await invoke('igni_is_fullscreen');
        const html = document.documentElement;
        if (!html) return;
        const prev = html.dataset.fullscreen === 'true';
        if (!!fs !== prev) {
          html.dataset.fullscreen = fs ? 'true' : 'false';
          console.log('[igni] fullscreen ->', fs);
        }
      } catch (e) {
        console.warn('[igni] igni_is_fullscreen failed:', e);
      }
    };
    sync();
    window.addEventListener('resize', sync);
    setInterval(sync, 300);
  });
})();
