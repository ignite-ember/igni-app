// @vitest-environment jsdom
/**
 * ``BotAvatar`` mounts the fluffy gallery cat once, passes each new look
 * to it, tears it down on unmount, and leaves the sidebar working when
 * the renderer cannot mount.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mountAvatar, update, destroy } = vi.hoisted(() => {
  const update = vi.fn();
  const destroy = vi.fn();
  return { update, destroy, mountAvatar: vi.fn(() => ({ update, destroy })) };
});
vi.mock("open-bot-avatar/dom", () => ({ mountAvatar }));

import { BotAvatar } from "./BotAvatar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BotAvatar", () => {
  it("mounts the fluffy amber cat once, following the pointer, with the look's state", () => {
    const { container } = render(<BotAvatar look={{ state: "thinking", mood: "neutral" }} />);
    expect(mountAvatar).toHaveBeenCalledTimes(1);
    const [host, options] = mountAvatar.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>];
    expect(host).toBe(container.querySelector(".sidebar-bot-avatar"));
    expect(options).toMatchObject({
      color: "#f8a01c",
      material: "fluffy",
      followPointer: true,
      state: "thinking",
      mood: "neutral",
      label: "igni is thinking",
    });
    expect((options.definition as { id: string }).id).toBe("cat");
    expect(host.getAttribute("data-state")).toBe("thinking");
    expect(host.style.width).toBe("30px");
  });

  it("passes a new look to the mounted cat instead of mounting again", () => {
    const { rerender } = render(<BotAvatar look={{ state: "idle", mood: "neutral" }} />);
    update.mockClear();
    rerender(<BotAvatar look={{ state: "done", mood: "happy" }} />);
    expect(mountAvatar).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ state: "done", mood: "happy", label: "igni finished" });
  });

  it("does not redraw when the look is the same", () => {
    const { rerender } = render(<BotAvatar look={{ state: "idle", mood: "neutral" }} />);
    update.mockClear();
    rerender(<BotAvatar look={{ state: "idle", mood: "neutral" }} />);
    expect(update).not.toHaveBeenCalled();
  });

  it("destroys the cat on unmount", () => {
    const { unmount } = render(<BotAvatar look={{ state: "idle", mood: "neutral" }} />);
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("renders its box when the renderer throws", () => {
    mountAvatar.mockImplementationOnce(() => {
      throw new Error("no canvas");
    });
    const { container, rerender, unmount } = render(
      <BotAvatar look={{ state: "idle", mood: "neutral" }} size={40} />,
    );
    const box = container.querySelector<HTMLElement>(".sidebar-bot-avatar");
    expect(box?.style.width).toBe("40px");
    rerender(<BotAvatar look={{ state: "working", mood: "neutral" }} size={40} />);
    unmount();
    expect(update).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});
