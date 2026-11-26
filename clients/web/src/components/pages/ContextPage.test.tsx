// @vitest-environment jsdom
/**
 * The context page: the reading, a round refresh icon in the header
 * that reads it again, and Compact.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ContextPage } from "./ContextPage";

afterEach(cleanup);

function page(answer: () => unknown) {
  const rpc = vi.fn(async () => answer());
  const onCompact = vi.fn();
  render(<ContextPage client={{ rpc } as never} maxContext={10_000} onCompact={onCompact} onClose={() => {}} />);
  return { rpc, onCompact };
}

describe("the context page", () => {
  it("shows the total and its share of the window", async () => {
    page(() => ({ total: 1000, runs: 750, floor: 250 }));
    expect(await screen.findByText("1,000")).toBeTruthy();
    expect(screen.getByText("10.0% of a 10,000 window")).toBeTruthy();
  });

  it("reads the context again from the refresh icon", async () => {
    const { rpc } = page(() => ({ total: 1000, runs: 750, floor: 250 }));
    await screen.findByText("1,000");
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh.className).toContain("button--icon");
    fireEvent.click(refresh);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  });

  it("says why when the reading fails", async () => {
    page(() => {
      throw new Error("offline");
    });
    expect(await screen.findByText(/Could not read the context: Error: offline/)).toBeTruthy();
  });

  it("compacts from its button", async () => {
    const { onCompact } = page(() => ({ total: 10, runs: 5, floor: 5 }));
    fireEvent.click(await screen.findByRole("button", { name: "Compact the conversation" }));
    expect(onCompact).toHaveBeenCalled();
  });
});
