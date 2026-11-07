/**
 * The popup a click opens from the composer's bar: the tools list, the
 * model picker or the send button's mode menu. One at a time — opening
 * one closes the others, and the completion menu too.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { IgniClient } from "../../protocol/client";
import type { ModelChoice } from "../../protocol/composerWire";

export type ComposerPopup =
  | { kind: "none" }
  | { kind: "tools" }
  | { kind: "model"; models: ModelChoice[] }
  | { kind: "mode" };

const NONE: ComposerPopup = { kind: "none" };

export interface ComposerPopupApi {
  popup: ComposerPopup;
  toggleTools: () => void;
  toggleModel: () => void;
  toggleMode: () => void;
  close: () => void;
}

export function useComposerPopup({
  client,
  modelMenuSignal,
  onOpen,
}: {
  client: Pick<IgniClient, "modelRegistry">;
  /** A request from outside (the /model command) to open the model picker. */
  modelMenuSignal?: { n: number } | null;
  /** A popup is opening: whatever else is open should close. */
  onOpen: () => void;
}): ComposerPopupApi {
  const [popup, setPopup] = useState<ComposerPopup>(NONE);
  const close = useCallback(() => setPopup(NONE), []);

  const open = useCallback(
    (next: ComposerPopup) => {
      onOpen();
      setPopup(next);
    },
    [onOpen],
  );

  const openModel = useCallback(async () => {
    const result = await client.modelRegistry();
    if (result.ok) open({ kind: "model", models: result.models });
    else console.warn("Model registry unavailable:", result.reason);
  }, [client, open]);

  // The /model command routes here so there is a single picker. Each
  // request is a new `n`; one already handled is not reopened when this
  // re-renders.
  const handledSignal = useRef<number | null>(null);
  useEffect(() => {
    if (!modelMenuSignal || handledSignal.current === modelMenuSignal.n) return;
    handledSignal.current = modelMenuSignal.n;
    void openModel();
  }, [modelMenuSignal, openModel]);

  // Escape closes the model picker, and must not cancel a running turn.
  const modelOpen = popup.kind === "model";
  useEffect(() => {
    if (!modelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [modelOpen, close]);

  const toggle = (kind: "tools" | "mode") =>
    popup.kind === kind ? close() : open({ kind });

  return {
    popup,
    toggleTools: () => toggle("tools"),
    toggleMode: () => toggle("mode"),
    toggleModel: () => (modelOpen ? close() : void openModel()),
    close,
  };
}
