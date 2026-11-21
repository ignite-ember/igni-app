// A minimal W3C WebDriver client for driving igni's desktop app through
// tauri-driver (which fronts WebKitWebDriver on Linux and msedgedriver on
// Windows). Plain `fetch`, no dependencies: the desktop suite adds nothing
// to the app's npm tree, its lockfile or its dependency audit.

const ELEMENT = "element-6066-11e4-a52f-4f735466cecf";

export class WebDriverError extends Error {}

/** A web element reference: the W3C key, or the legacy "ELEMENT" some
 *  drivers still answer with, or whatever single key the driver used. */
function elementId(ref) {
  if (!ref || typeof ref !== "object") throw new WebDriverError(`not an element reference: ${JSON.stringify(ref)}`);
  return ref[ELEMENT] ?? ref.ELEMENT ?? Object.values(ref)[0];
}

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  /** Start a session for the app binary at `application`. */
  static async start(base, application, { args = [], env } = {}) {
    const caps = { "tauri:options": { application, args } };
    if (env) caps["tauri:options"].env = env;
    const res = await call(base, "POST", "/session", {
      capabilities: { alwaysMatch: caps },
    });
    return new Session(base, res.sessionId ?? res.value?.sessionId);
  }

  /** Start a session with these capabilities as they are. */
  static async startWith(base, alwaysMatch) {
    const res = await call(base, "POST", "/session", { capabilities: { alwaysMatch } });
    return new Session(base, res.sessionId ?? res.value?.sessionId);
  }

  cmd(method, path, body) {
    return call(this.base, method, `/session/${this.id}${path}`, body).then((r) => r.value);
  }

  async quit() {
    try {
      await this.cmd("DELETE", "");
    } catch {
      /* already gone */
    }
  }

  url() {
    return this.cmd("GET", "/url");
  }

  title() {
    return this.cmd("GET", "/title");
  }

  /** Run `script` (a function body) in the page; `arguments` holds `args`. */
  exec(script, ...args) {
    return this.cmd("POST", "/execute/sync", { script, args });
  }

  /** Like exec, but the body calls `arguments[arguments.length - 1](result)`. */
  execAsync(script, ...args) {
    return this.cmd("POST", "/execute/async", { script, args });
  }

  async find(css) {
    const v = await this.cmd("POST", "/element", { using: "css selector", value: css });
    return new Element(this, elementId(v));
  }

  async findAll(css) {
    const v = await this.cmd("POST", "/elements", { using: "css selector", value: css });
    return v.map((e) => new Element(this, elementId(e)));
  }

  /** Base64 PNG of the window. */
  screenshot() {
    return this.cmd("GET", "/screenshot");
  }

  windowHandles() {
    return this.cmd("GET", "/window/handles");
  }

  switchTo(handle) {
    return this.cmd("POST", "/window", { handle });
  }

  /** Poll `fn` until it returns a truthy value or `timeout` ms pass. */
  async waitFor(what, fn, { timeout = 60_000, interval = 500 } = {}) {
    const end = Date.now() + timeout;
    let last;
    for (;;) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (e) {
        last = e;
      }
      if (Date.now() > end) {
        throw new WebDriverError(`timed out after ${timeout} ms waiting for ${what}${last ? `: ${last.message}` : ""}`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /** The page's visible text. */
  bodyText() {
    return this.exec("return document.body ? document.body.innerText : ''");
  }
}

export class Element {
  constructor(session, id) {
    this.s = session;
    this.id = id;
  }
  click() {
    return this.s.cmd("POST", `/element/${this.id}/click`, {});
  }
  type(text) {
    return this.s.cmd("POST", `/element/${this.id}/value`, { text });
  }
  text() {
    return this.s.cmd("GET", `/element/${this.id}/text`);
  }
  attr(name) {
    return this.s.cmd("GET", `/element/${this.id}/attribute/${name}`);
  }
}

async function call(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new WebDriverError(`${method} ${path}: HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.ok || (json.value && json.value.error)) {
    const v = json.value || {};
    throw new WebDriverError(`${method} ${path}: ${v.error || res.status}: ${v.message || text.slice(0, 500)}`);
  }
  return json;
}
