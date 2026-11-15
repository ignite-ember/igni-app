// @vitest-environment jsdom
/** The recovery banner's actions under an interrupted reply. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantMessage } from "./AssistantMessage";

afterEach(cleanup);

const handlers = { retry: vi.fn(), discard: vi.fn(), editPrompt: vi.fn() };

describe("AssistantMessage's banner", () => {
  it("offers Discard under a live interruption", () => {
    render(<AssistantMessage item={{ kind: "assistant", id: 1, text: "partial", interrupted: "cancelled" }} handlers={handlers} />);
    expect((screen.getByRole("button", { name: /discard/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers Retry and Edit prompt, not Discard, under prompts restored after a crash (R652)", () => {
    // The backend has no call that discards a pending row: a Discard
    // here would come back with the next load.
    render(
      <AssistantMessage
        item={{ kind: "assistant", id: 1, text: "", interrupted: "abandoned", restored: true }}
        handlers={handlers}
      />,
    );
    expect((screen.getByRole("button", { name: /^retry/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /edit prompt/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /discard/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
