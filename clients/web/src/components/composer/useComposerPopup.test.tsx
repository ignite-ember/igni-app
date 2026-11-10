// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import type { ModelRegistryResult } from "../../protocol/composerWire";
import { useComposerPopup, type ModelMenuRequest } from "./useComposerPopup";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MODELS: ModelRegistryResult = {
  ok: true,
  models: [
    { name: "a-model", current: false },
    { name: "b-model", current: true },
  ],
};

function mount(registry: ModelRegistryResult = MODELS, signal: ModelMenuRequest | null = null) {
  const client = { calls: { modelRegistry: vi.fn(async () => registry) } };
  const onOpen = vi.fn();
  const hook = renderHook(
    ({ modelMenuSignal }: { modelMenuSignal: ModelMenuRequest | null }) =>
      useComposerPopup({ client, modelMenuSignal, onOpen }),
    { initialProps: { modelMenuSignal: signal } },
  );
  return { hook, client, onOpen };
}

describe("useComposerPopup", () => {
  it("shows one popup at a time: opening another replaces it", () => {
    const { hook } = mount();
    act(() => hook.result.current.toggleTools());
    expect(hook.result.current.popup.kind).toBe("tools");
    act(() => hook.result.current.toggleMode());
    expect(hook.result.current.popup.kind).toBe("mode");
    act(() => hook.result.current.toggleMode());
    expect(hook.result.current.popup.kind).toBe("none");
  });

  it("closes whatever else is open (the completion menu) when one opens", () => {
    const { hook, onOpen } = mount();
    act(() => hook.result.current.toggleTools());
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.toggleTools());
    // Closing is not opening.
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the model picker with the registry's models, and toggles it shut", async () => {
    const { hook } = mount();
    await act(async () => hook.result.current.toggleModel());
    expect(hook.result.current.popup).toEqual({ kind: "model", models: MODELS.ok ? MODELS.models : [] });
    act(() => hook.result.current.toggleModel());
    expect(hook.result.current.popup.kind).toBe("none");
  });

  it("opens nothing when the registry cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { hook } = mount({ ok: false, reason: "offline" });
    await act(async () => hook.result.current.toggleModel());
    expect(hook.result.current.popup.kind).toBe("none");
    expect(warn).toHaveBeenCalled();
  });

  it("opens the picker for each new /model request, once", async () => {
    const { hook, client } = mount(MODELS, { n: 1 });
    await vi.waitFor(() => expect(hook.result.current.popup.kind).toBe("model"));
    act(() => hook.result.current.close());
    hook.rerender({ modelMenuSignal: { n: 1 } });
    expect(hook.result.current.popup.kind).toBe("none");
    hook.rerender({ modelMenuSignal: { n: 2 } });
    await vi.waitFor(() => expect(hook.result.current.popup.kind).toBe("model"));
    expect(client.calls.modelRegistry).toHaveBeenCalledTimes(2);
  });

  it("closes the model picker on Escape without letting the key cancel a run", async () => {
    const { hook } = mount();
    await act(async () => hook.result.current.toggleModel());
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    window.removeEventListener("keydown", behind);
    expect(hook.result.current.popup.kind).toBe("none");
    expect(behind).not.toHaveBeenCalled();
  });
});
