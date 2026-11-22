// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BackendSnapshot } from "../cloud/backendState";
import { shellSnapshot } from "../cloud/testing";
import { BackendChip } from "./BackendChip";
import { BackendSwitch } from "./BackendSwitch";

afterEach(cleanup);

const snap = (o: Record<string, unknown> = {}) => BackendSnapshot.parse(shellSnapshot(o))!;

describe("BackendSwitch", () => {
  it("shows This computer · Cloud only when the shell offers the switch", () => {
    const { rerender } = render(<BackendSwitch backend={snap()} />);
    expect(screen.getByRole("radiogroup", { name: "Where igni runs" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "This computer" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Cloud" }).getAttribute("aria-checked")).toBe("false");
    rerender(<BackendSwitch backend={snap({ switch_visible: false })} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("flips to the other side and not to the one it is on", async () => {
    const switchTo = vi.fn(async () => undefined);
    render(<BackendSwitch backend={snap()} switchTo={switchTo} />);
    fireEvent.click(screen.getByRole("radio", { name: "This computer" }));
    expect(switchTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    expect(switchTo).toHaveBeenCalledWith("cloud");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Cloud" })).toHaveProperty("disabled", false));
  });

  it("says why a switch was refused", async () => {
    const switchTo = vi.fn(async () => {
      throw new Error("Can't reach igni server (dns).");
    });
    render(<BackendSwitch backend={snap()} switchTo={switchTo} />);
    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Can't reach igni server (dns).");
  });

  it("shows what still waits on this computer, and the badge switches back", () => {
    const switchTo = vi.fn(async () => undefined);
    render(<BackendSwitch backend={snap({ side: "cloud", state: "cloud_ready", local_activity: { runs: 0, approvals: 1 } })} switchTo={switchTo} />);
    fireEvent.click(screen.getByRole("button", { name: "1 waiting on this computer" }));
    expect(switchTo).toHaveBeenCalledWith("local");
  });

  it("has no badge on the local side or with nothing waiting", () => {
    render(<BackendSwitch backend={snap({ local_activity: { runs: 2, approvals: 0 } })} />);
    expect(screen.queryByText(/waiting on this computer/)).toBeNull();
  });
});

describe("BackendChip", () => {
  it("is drawn only when the shell says so, with the state's label", () => {
    const { rerender, container } = render(<BackendChip backend={snap({ side: "cloud", state: "waking" })} />);
    expect(screen.getByText("Cloud · waking…")).toBeTruthy();
    rerender(<BackendChip backend={snap({ chip_visible: false })} />);
    expect(container.textContent).toBe("");
    rerender(<BackendChip backend={null} />);
    expect(container.textContent).toBe("");
  });

  it("shows Cloud with no control in cloud mode", () => {
    render(<BackendChip backend={snap({ side: "cloud", state: "cloud_ready", mode: "cloud", switch_visible: false })} />);
    const chip = screen.getByText("Cloud").closest("button")!;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe("Your organisation runs igni for you in the cloud");
  });

  it("warns when the VM cannot reach igni server", () => {
    render(<BackendChip backend={snap({ side: "cloud", state: "cloud_ready", credential_warning: true })} />);
    expect(screen.getByText("Cloud").closest("button")!.className).toContain("tone-warn");
  });
});
