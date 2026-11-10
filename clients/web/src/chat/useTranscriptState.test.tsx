// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import type { AssistantItem } from "./chatItem";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { useRunPhase } from "./useRunPhase";
import { useStampCancelledReply, useTranscriptState } from "./useTranscriptState";

afterEach(cleanup);

/** The window's run and transcript as App wires them: Stop is
 *  ``run.cancel``, and the stamp follows the phase. */
function mountWindow() {
  const client = { cancel: vi.fn() };
  const chatItems = new ChatItemFactory(new ChatItemIds());
  const hook = renderHook(() => {
    const transcript = useTranscriptState(chatItems);
    const run = useRunPhase(client as never);
    useStampCancelledReply(run.runPhase, transcript.view);
    return { transcript, run };
  });
  const reply = () => hook.result.current.transcript.items.find((it): it is AssistantItem => it.kind === "assistant");
  return { hook, client, chatItems, reply };
}

describe("useStampCancelledReply", () => {
  it("stamps the streaming reply when the composer's Stop cancels the run", () => {
    const w = mountWindow();
    act(() => {
      w.hook.result.current.transcript.view.append(w.chatItems.user("go"));
      w.hook.result.current.transcript.view.append(w.chatItems.assistant("partial"));
      w.hook.result.current.run.setRunPhase("streaming");
    });
    act(() => w.hook.result.current.run.cancel());
    expect(w.client.cancel).toHaveBeenCalledTimes(1);
    expect(w.hook.result.current.run.runPhase).toBe("cancelled");
    expect(w.reply()?.interrupted).toBe("cancelled");
  });

  it("leaves a reply that finished normally alone", () => {
    const w = mountWindow();
    act(() => {
      w.hook.result.current.transcript.view.append(w.chatItems.assistant("done"));
      w.hook.result.current.run.setRunPhase("streaming");
    });
    act(() => w.hook.result.current.run.setRunPhase("done"));
    expect(w.reply()?.interrupted).toBeUndefined();
  });

  it("stamps on the transition only, not again while the phase stays cancelled", () => {
    const w = mountWindow();
    act(() => {
      w.hook.result.current.transcript.view.append(w.chatItems.assistant("partial"));
      w.hook.result.current.run.setRunPhase("streaming");
    });
    act(() => w.hook.result.current.run.cancel());
    // The person resumed from the partial, which clears the stamp; a
    // re-render while still cancelled must not put it back.
    act(() =>
      w.hook.result.current.transcript.view.edit((items) =>
        items.map((it) => (it.kind === "assistant" ? { ...it, interrupted: undefined } : it)),
      ),
    );
    w.hook.rerender();
    expect(w.reply()?.interrupted).toBeUndefined();
  });
});
