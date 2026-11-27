/**
 * xterm's colours and font, read from the stylesheet's tokens so the
 * terminal follows the app's light and dark themes rather than keeping
 * a palette of its own.
 */

import type { ITheme } from "@xterm/xterm";

/** Used when a token reads empty (jsdom, a stylesheet not loaded yet). */
const FALLBACK = {
  bg: "#1f1f1d",
  fg: "#f0efea",
  accent: "#ee6138",
  font: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

/** ``#rrggbb`` at ``alpha`` as ``#rrggbbaa``; anything else as it is. */
function translucent(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

export interface XtermLook {
  theme: ITheme;
  fontFamily: string;
}

/** The terminal's look under the document's theme as it is now. */
export function readXtermLook(root: HTMLElement = document.documentElement): XtermLook {
  const style = getComputedStyle(root);
  const background = token(style, "--bg-inset", token(style, "--bg", FALLBACK.bg));
  const foreground = token(style, "--fg", FALLBACK.fg);
  const accent = token(style, "--accent", FALLBACK.accent);
  return {
    theme: {
      background,
      foreground,
      cursor: accent,
      cursorAccent: background,
      selectionBackground: translucent(accent, "55"),
    },
    fontFamily: token(style, "--font-mono", FALLBACK.font),
  };
}

/** Call ``onChange`` whenever the document's theme may have moved: the
 *  in-app toggle and the IDE bridge set attributes on ``<html>``, and
 *  ``auto`` follows the OS. Returns the unsubscribe. */
export function watchDocumentTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-os-prefers-light"],
  });
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.("change", onChange);
  };
}
