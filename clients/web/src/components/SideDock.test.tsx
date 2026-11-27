// @vitest-environment jsdom
/**
 * The dock's layout: the files, the terminal, or both with a splitter —
 * and the terminal kept mounted (its shell alive) while the files open
 * and close above it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SideDock } from "./SideDock";

const mounts = vi.hoisted(() => ({ terminal: 0, unmounts: 0 }));

vi.mock("./FilesDock", () => ({
  FilesDock: (props: { onToggleMaximize: () => void; onClose: () => void }) => (
    <div data-testid="files">
      <button onClick={props.onToggleMaximize}>Files full screen</button>
      <button onClick={props.onClose}>Close Files</button>
    </div>
  ),
}));

vi.mock("./terminal/TerminalPane", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalPane: (props: { maximized: boolean; onClose: () => void }) => {
      useEffect(() => {
        mounts.terminal += 1;
        return () => {
          mounts.unmounts += 1;
        };
      }, []);
      return (
        <div data-testid="terminal" data-maximized={String(props.maximized)}>
          <button onClick={props.onClose}>Close terminal</button>
        </div>
      );
    },
  };
});

beforeEach(() => {
  mounts.terminal = 0;
  mounts.unmounts = 0;
  localStorage.clear();
});

afterEach(cleanup);

function dock(filesOpen: boolean, terminalOpen: boolean, extra: Partial<Parameters<typeof SideDock>[0]> = {}) {
  return (
    <SideDock
      client={{} as never}
      connected
      filesSession={{} as never}
      terminals={{} as never}
      filesOpen={filesOpen}
      terminalOpen={terminalOpen}
      onCloseFiles={() => {}}
      onCloseTerminal={() => {}}
      {...extra}
    />
  );
}

describe("SideDock", () => {
  it("shows the files alone, as before", () => {
    render(dock(true, false));
    expect(screen.getByRole("complementary", { name: "Files" })).toBeTruthy();
    expect(screen.getByTestId("files")).toBeTruthy();
    expect(screen.queryByTestId("terminal")).toBeNull();
    expect(document.querySelector(".dock-split")).toBeNull();
  });

  it("shows the terminal alone", () => {
    render(dock(false, true));
    expect(screen.getByRole("complementary", { name: "Terminal" })).toBeTruthy();
    expect(screen.queryByTestId("files")).toBeNull();
    expect(document.querySelector(".dock-split")).toBeNull();
  });

  it("splits the files above the terminal when both are open", () => {
    render(dock(true, true));
    const aside = screen.getByRole("complementary", { name: "Files and terminal" });
    const sections = aside.querySelectorAll(".dock-section");
    expect([...sections].map((s) => s.firstElementChild?.getAttribute("data-testid"))).toEqual([
      "files",
      "terminal",
    ]);
    expect(aside.querySelector(".dock-split")?.getAttribute("aria-orientation")).toBe("horizontal");
    expect((sections[0] as HTMLElement).style.flexGrow).toBe("0.6");
    expect((sections[1] as HTMLElement).style.flexGrow).toBe("0.4");
  });

  it("keeps the terminal mounted while the files open and close", () => {
    const view = render(dock(false, true));
    view.rerender(dock(true, true));
    view.rerender(dock(false, true));
    expect(mounts.terminal).toBe(1);
    expect(mounts.unmounts).toBe(0);
  });

  it("drags the splitter and remembers the split", () => {
    render(dock(true, true));
    const [files, terminal] = [...document.querySelectorAll<HTMLElement>(".dock-section")];
    Object.defineProperty(files, "offsetHeight", { value: 300 });
    Object.defineProperty(terminal, "offsetHeight", { value: 100 });
    files.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    fireEvent.pointerDown(document.querySelector(".dock-split")!, { clientY: 400 });
    fireEvent.pointerMove(window, { clientY: 300 });
    expect(files.style.flexGrow).toBe("0.5");
    expect(terminal.style.flexGrow).toBe("0.5");
    // Held to the bounds: neither side vanishes.
    fireEvent.pointerMove(window, { clientY: 100 });
    expect(files.style.flexGrow).toBe("0.15");
    fireEvent.pointerUp(window);
    expect(JSON.parse(localStorage.getItem("igni.files.prefs")!).dockSplit).toBe(0.15);
  });

  it("restores a remembered split", () => {
    localStorage.setItem("igni.files.prefs", JSON.stringify({ dockSplit: 0.3 }));
    render(dock(true, true));
    expect(document.querySelector<HTMLElement>(".dock-section--files")!.style.flexGrow).toBe("0.3");
  });

  it("drags the left edge to resize and remembers the width", () => {
    render(dock(false, true));
    const aside = screen.getByRole("complementary");
    Object.defineProperty(aside, "offsetWidth", { get: () => parseInt(aside.style.width, 10) });
    fireEvent.pointerDown(document.querySelector(".files-dock-resize")!, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 400 });
    expect(aside.style.width).toBe("780px");
    fireEvent.pointerUp(window);
    expect(JSON.parse(localStorage.getItem("igni.files.prefs")!).dockWidth).toBe(780);
  });

  it("goes full screen for both sections at once", () => {
    render(dock(true, true));
    fireEvent.click(screen.getByRole("button", { name: "Files full screen" }));
    expect(screen.getByRole("complementary").className).toContain("files-dock--full");
    expect(screen.getByTestId("terminal").dataset.maximized).toBe("true");
    expect(document.querySelector(".files-dock-resize")).toBeNull();
  });

  it("closes each section through its own callback", () => {
    const onCloseFiles = vi.fn();
    const onCloseTerminal = vi.fn();
    render(dock(true, true, { onCloseFiles, onCloseTerminal }));
    fireEvent.click(screen.getByRole("button", { name: "Close Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(onCloseFiles).toHaveBeenCalledTimes(1);
    expect(onCloseTerminal).toHaveBeenCalledTimes(1);
  });
});
