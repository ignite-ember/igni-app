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

  it("offers Retry, Edit prompt and Discard under prompts restored after a crash (R652)", () => {
    // Discard drops the pending rows through discard_pending_message.
    render(
      <AssistantMessage
        item={{ kind: "assistant", id: 1, text: "", interrupted: "abandoned", restored: true }}
        handlers={handlers}
      />,
    );
    expect((screen.getByRole("button", { name: /^retry/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /edit prompt/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /discard/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
