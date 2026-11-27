/**
 * A playground for the top fade: how content blurs and dissolves as it
 * scrolls up under fixed chrome.
 *
 * Reachable at ``?demo=fade`` (see ``main.tsx``). Every value the app uses
 * — the blur's strength and reach, how many layers build it up, and where
 * the content's opacity starts and ends — is a slider here, drawn live over
 * a list that scrolls under a header, so the owner can tune it until it
 * reads right and copy the result out.
 *
 * One blur layer behind a mask only cross-fades a blurred copy over the
 * sharp one, so text stays readable until the opacity takes it. Several
 * layers, each blurring more and reaching less far down, blur
 * progressively: the "Layers" slider is that.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

/** Every tunable, in px from the top of the window unless noted. */
interface FadeParams {
  /** The fixed header's height. */
  headerH: number;
  /** The strongest blur, at the top. */
  maxBlur: number;
  /** How many stacked layers build the blur up. */
  layers: number;
  /** Where the blur begins (content below is sharp). */
  blurStart: number;
  /** Where the blur reaches its strongest. */
  blurFull: number;
  /** Where the content is still fully opaque. */
  fadeSolid: number;
  /** Where the content has fully dissolved. */
  fadeGone: number;
  /** Grows each layer's blur geometrically (true) or linearly. */
  geometric: boolean;
}

const CURRENT: FadeParams = {
  headerH: 58,
  maxBlur: 6,
  layers: 1,
  blurStart: 82,
  blurFull: 0,
  fadeSolid: 57,
  fadeGone: 0,
  geometric: false,
};

const BLUR_FIRST: FadeParams = {
  headerH: 58,
  maxBlur: 18,
  layers: 5,
  blurStart: 130,
  blurFull: 30,
  fadeSolid: 50,
  fadeGone: 4,
  geometric: true,
};

const STORAGE_KEY = "igni:fade-demo";

function loadParams(): FadeParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...CURRENT, ...(JSON.parse(raw) as Partial<FadeParams>) };
  } catch {
    // Storage blocked: start from the app's values.
  }
  return CURRENT;
}

/** Smoothstep at nine points between two y positions, as gradient stops. */
function smoothStops(from: number, to: number, fromAlpha: number, toAlpha: number): string[] {
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const s = t * t * (3 - 2 * t);
    const a = fromAlpha + (toAlpha - fromAlpha) * s;
    stops.push(`rgba(0, 0, 0, ${a.toFixed(3)}) ${(from + (to - from) * t).toFixed(2)}px`);
  }
  return stops;
}

/** The content's opacity mask: gone at ``fadeGone``, solid from ``fadeSolid``. */
function fadeMask(p: FadeParams): string {
  const gone = Math.min(p.fadeGone, p.fadeSolid);
  return `linear-gradient(to bottom, transparent 0px, ${smoothStops(gone, p.fadeSolid, 0, 1).join(", ")}, #000 100%)`;
}

/** One blur layer: its strength and the band it covers. */
interface BlurLayer {
  blur: number;
  /** Fully on from the top down to here. */
  solidTo: number;
  /** Gone from here down. */
  goneAt: number;
}

/**
 * The stack: layer 0 is the weakest and reaches furthest down (to
 * ``blurStart``); the last is the strongest and stops highest, solid only
 * above ``blurFull``. Each one's lower edge is soft over one step.
 */
function blurLayers(p: FadeParams): BlurLayer[] {
  const n = Math.max(1, Math.round(p.layers));
  const span = Math.max(1, p.blurStart - p.blurFull);
  const step = span / n;
  return Array.from({ length: n }, (_, k) => {
    const blur = p.geometric ? p.maxBlur / 2 ** (n - 1 - k) : (p.maxBlur * (k + 1)) / n;
    const goneAt = p.blurStart - k * step;
    return { blur, solidTo: Math.max(0, goneAt - step), goneAt };
  });
}

function layerStyle(layer: BlurLayer): CSSProperties {
  const mask = `linear-gradient(to bottom, #000 0px, ${smoothStops(layer.solidTo, layer.goneAt, 1, 0).join(", ")}, transparent 100%)`;
  return {
    height: Math.ceil(layer.goneAt) + 1,
    backdropFilter: `blur(${layer.blur.toFixed(2)}px)`,
    WebkitBackdropFilter: `blur(${layer.blur.toFixed(2)}px)`,
    maskImage: mask,
    WebkitMaskImage: mask,
  };
}

/** Frames per second, measured while anything moves. */
function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames++;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

const CARDS = [
  ["api-security-testing", "Audit OpenAPI specs and catch security issues before they ship.", "Security 1.2.0"],
  ["postgres-toolkit", "Query, migrate and inspect Postgres from chat.", "Database 3.1.0"],
  ["design-handoff", "Pull the latest frames for the screen you are on.", "Design 0.9.0"],
  ["agent-sdk-dev", "Scaffolding and helpers for building agents.", "Development 2.0.1"],
  ["uptime-watch", "Alert the channel the moment an endpoint goes down.", "Monitoring 1.0.0"],
  ["focus-timer", "A Pomodoro timer and a daily plan that follows your commits.", "Productivity 1.4.0"],
  ["ship-it", "One-command deploys to any of your clouds.", "Deployment 2.2.0"],
  ["nightly-automation", "Run chores on a schedule and report back.", "Automation 1.1.0"],
];

const PROSE =
  "Audit OpenAPI specs, detect vulnerabilities aligned with OWASP API risks, and apply fixes in an audit, scan, remediate, validate loop.";

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="fade-demo-slider">
      <span className="fade-demo-slider-head">
        <span>{label}</span>
        <code>
          {value}
          {unit}
        </code>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function FadeDemo() {
  const [p, setP] = useState<FadeParams>(loadParams);
  const [content, setContent] = useState<"cards" | "chat">("cards");
  const [zones, setZones] = useState(false);
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fps = useFps();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // Storage blocked: the values still apply for this visit.
    }
  }, [p]);

  // Start a little scrolled, so the effect is visible without touching it.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 140;
  }, [content]);

  const set = <K extends keyof FadeParams>(key: K) => (v: FadeParams[K]) => setP((old) => ({ ...old, [key]: v }));
  const layers = useMemo(() => blurLayers(p), [p]);
  const mask = useMemo(() => fadeMask(p), [p]);
  const result = useMemo(
    () =>
      JSON.stringify(
        { ...p, layerBlurs: layers.map((l) => +l.blur.toFixed(2)), layerBands: layers.map((l) => [+l.solidTo.toFixed(1), +l.goneAt.toFixed(1)]) },
        null,
        2,
      ),
    [p, layers],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked: the values are on screen to copy by hand.
    }
  };

  return (
    <div className="fade-demo">
      <style>{FADE_DEMO_CSS}</style>
      <div className="fade-demo-stage">
        <div ref={scroller} className="fade-demo-scroller" style={{ maskImage: mask, WebkitMaskImage: mask, paddingTop: p.headerH + 16 }}>
          {content === "cards" ? (
            <div className="fade-demo-grid">
              {[...CARDS, ...CARDS, ...CARDS].map(([name, desc, meta], i) => (
                <div key={i} className="fade-demo-card">
                  <div className="fade-demo-card-icon" />
                  <div>
                    <div className="fade-demo-card-name">{name}</div>
                    <div className="fade-demo-card-desc">{desc}</div>
                    <div className="fade-demo-card-meta">{meta}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="fade-demo-chat">
              {Array.from({ length: 30 }, (_, i) =>
                i % 4 === 3 ? (
                  <div key={i} className="fade-demo-bubble">
                    Question {i}: {PROSE}
                  </div>
                ) : (
                  <p key={i}>{PROSE}</p>
                ),
              )}
            </div>
          )}
        </div>
        {layers.map((layer, k) => (
          <div key={k} className="fade-demo-blur" style={layerStyle(layer)} />
        ))}
        <div className="fade-demo-header" style={{ height: p.headerH }}>
          <span className="fade-demo-title">Plugins</span>
          <span className="fade-demo-tab fade-demo-tab--on">Marketplace</span>
          <span className="fade-demo-tab">Installed</span>
          <span className="fade-demo-spacer" />
          <span className="fade-demo-icon" />
          <span className="fade-demo-icon" />
          <span className="fade-demo-icon" />
        </div>
        {zones && (
          <>
            <div className="fade-demo-zone fade-demo-zone--blur" style={{ top: p.blurFull, height: Math.max(0, p.blurStart - p.blurFull) }}>
              blur ramps up
            </div>
            <div className="fade-demo-zone fade-demo-zone--fade" style={{ top: Math.min(p.fadeGone, p.fadeSolid), height: Math.abs(p.fadeSolid - p.fadeGone) }}>
              opacity dissolves
            </div>
          </>
        )}
      </div>

      <aside className="fade-demo-panel">
        <h1>Top fade</h1>
        <p className="fade-demo-hint">
          Scroll the list. Blur should take the text first; opacity should finish it off above that. More layers give a
          truer progressive blur and cost more frames.
        </p>

        <div className="fade-demo-row">
          <button type="button" className="fade-demo-btn" onClick={() => setP(CURRENT)}>
            Current app
          </button>
          <button type="button" className="fade-demo-btn" onClick={() => setP(BLUR_FIRST)}>
            Blur first
          </button>
        </div>

        <h2>Blur</h2>
        <Slider label="Strength at the top" value={p.maxBlur} min={0} max={40} step={0.5} onChange={set("maxBlur")} />
        <Slider label="Layers" value={p.layers} min={1} max={8} unit="" onChange={set("layers")} />
        <Slider label="Starts at (from top)" value={p.blurStart} min={0} max={260} onChange={set("blurStart")} />
        <Slider label="Strongest at (from top)" value={p.blurFull} min={0} max={200} onChange={set("blurFull")} />
        <label className="fade-demo-check">
          <input type="checkbox" checked={p.geometric} onChange={(e) => set("geometric")(e.target.checked)} />
          Each layer doubles the blur (otherwise even steps)
        </label>

        <h2>Opacity</h2>
        <Slider label="Fully visible below" value={p.fadeSolid} min={0} max={200} onChange={set("fadeSolid")} />
        <Slider label="Fully gone above" value={p.fadeGone} min={0} max={160} onChange={set("fadeGone")} />

        <h2>Stage</h2>
        <Slider label="Header height" value={p.headerH} min={30} max={140} onChange={set("headerH")} />
        <div className="fade-demo-row">
          <button type="button" className={`fade-demo-btn${content === "cards" ? " on" : ""}`} onClick={() => setContent("cards")}>
            Cards
          </button>
          <button type="button" className={`fade-demo-btn${content === "chat" ? " on" : ""}`} onClick={() => setContent("chat")}>
            Chat
          </button>
          <label className="fade-demo-check">
            <input type="checkbox" checked={zones} onChange={(e) => setZones(e.target.checked)} />
            Show zones
          </label>
        </div>
        <p className="fade-demo-fps">
          {fps} fps · {layers.length} blur layer{layers.length === 1 ? "" : "s"}
        </p>

        <h2>Result</h2>
        <pre className="fade-demo-result">{result}</pre>
        <button type="button" className="fade-demo-btn" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy values"}
        </button>
      </aside>
    </div>
  );
}

const FADE_DEMO_CSS = `
.fade-demo { position: fixed; inset: 0; display: grid; grid-template-columns: 1fr 340px; background: var(--bg); color: var(--fg); font-family: var(--font-sans, system-ui); }
.fade-demo-stage { position: relative; overflow: hidden; }
.fade-demo-scroller { position: absolute; inset: 0; overflow-y: auto; padding-left: 32px; padding-right: 32px; padding-bottom: 48px; scrollbar-width: none; }
.fade-demo-scroller::-webkit-scrollbar { display: none; }
.fade-demo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; max-width: 900px; margin: 0 auto; }
.fade-demo-card { display: flex; gap: 14px; padding: 16px; border-radius: 16px; background: var(--bg-raised); }
.fade-demo-card-icon { flex: none; width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--border-soft); }
.fade-demo-card-name { font-weight: 600; margin-bottom: 4px; }
.fade-demo-card-desc { color: var(--fg-muted); font-size: 14px; line-height: 1.45; }
.fade-demo-card-meta { color: var(--fg-muted); font-size: 12px; margin-top: 8px; }
.fade-demo-chat { max-width: 720px; margin: 0 auto; line-height: 1.6; font-size: 15px; }
.fade-demo-chat p { margin: 0 0 18px; }
.fade-demo-bubble { margin: 0 0 18px auto; max-width: 80%; padding: 12px 16px; border-radius: 16px; background: var(--bg-raised); }
.fade-demo-blur { position: absolute; top: 0; left: 0; right: 0; pointer-events: none; }
.fade-demo-header { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: 0 32px; pointer-events: none; }
.fade-demo-title { font-size: 22px; font-weight: 700; margin-right: 8px; }
.fade-demo-tab { font-size: 14px; padding: 5px 12px; border-radius: 999px; color: var(--fg-muted); }
.fade-demo-tab--on { background: var(--bg-raised); color: var(--fg); }
.fade-demo-spacer { flex: 1; }
.fade-demo-icon { width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid var(--fg-muted); }
.fade-demo-zone { position: absolute; left: 0; width: 120px; font-size: 11px; padding: 2px 6px; pointer-events: none; }
.fade-demo-zone--blur { right: 0; left: auto; border-left: 2px dashed #3b82f6; color: #3b82f6; }
.fade-demo-zone--fade { border-right: 2px dashed #ef4444; color: #ef4444; }
.fade-demo-panel { overflow-y: auto; padding: 20px; border-left: 1px solid var(--border-soft); font-size: 13px; }
.fade-demo-panel h1 { font-size: 18px; margin: 0 0 6px; }
.fade-demo-panel h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); margin: 18px 0 8px; }
.fade-demo-hint { color: var(--fg-muted); line-height: 1.45; margin: 0 0 12px; }
.fade-demo-slider { display: block; margin: 0 0 10px; }
.fade-demo-slider-head { display: flex; justify-content: space-between; margin-bottom: 3px; }
.fade-demo-slider input { width: 100%; }
.fade-demo-check { display: flex; gap: 6px; align-items: center; color: var(--fg-muted); }
.fade-demo-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.fade-demo-btn { font: inherit; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border-soft); background: transparent; color: var(--fg); cursor: pointer; }
.fade-demo-btn.on, .fade-demo-btn:hover { background: var(--bg-raised); }
.fade-demo-fps { color: var(--fg-muted); margin: 10px 0 0; font-variant-numeric: tabular-nums; }
.fade-demo-result { font-size: 11px; background: var(--bg-raised); padding: 10px; border-radius: 8px; overflow-x: auto; }
`;
