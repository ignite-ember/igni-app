// @vitest-environment jsdom
/**
 * The header names whoever is signed in, and offers "Log in" only when
 * nobody is.
 *
 * Who is signed in is `cloud_email`, the address on disk — the same
 * thing the sign-in wall goes by. `cloud_connected` says whether the
 * igni server answered the last request, which an air-gapped, on-prem
 * install can lack while the person is plainly signed in. The chip
 * used to switch on `cloud_connected`, so that person was offered
 * "Log in"; it then said "not connected to the igni server", which
 * reads like "you are not signed in" — a different thing, and the
 * reason R638 asked the chip to say which of the two it is.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AccountChip } from "./AccountChip";

afterEach(() => cleanup());

function chip(status: { cloud_email?: string; cloud_connected: boolean } | null) {
  const onOpenAccount = vi.fn();
  const onLogIn = vi.fn();
  render(
    <AccountChip
      status={status}
      name={status?.cloud_email || "Account"}
      onOpenAccount={onOpenAccount}
      onLogIn={onLogIn}
    />,
  );
  return { onOpenAccount, onLogIn };
}

describe("the account chip", () => {
  it("names a signed-in person whose session is not connected", () => {
    const { onOpenAccount } = chip({ cloud_email: "ann@acme.example", cloud_connected: false });
    expect(screen.queryByText("Log in")).toBeNull();
    fireEvent.click(screen.getByText("ann@acme.example"));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });

  it("says it is signed in, on the chip's title, when the server is not answering", () => {
    // The two states the backend can express are "nobody is signed in"
    // and "somebody is signed in"; the flag only says whether the igni
    // server answered. The title must not read as "you are signed out".
    chip({ cloud_email: "ann@acme.example", cloud_connected: false });
    const title = screen.getByRole("button").getAttribute("title") || "";
    expect(title).toMatch(/signed in/i);
    expect(title).toMatch(/igni server/i);
    expect(title).not.toMatch(/not connected/i);
  });

  it("marks the chip, so it says so without a hover", () => {
    chip({ cloud_email: "ann@acme.example", cloud_connected: false });
    const marker = screen.getByRole("img", { name: /not answering/i });
    expect(marker.className).toContain("not-answering");
    // The marker is on the chip of the signed-in person.
    expect(marker.closest(".chip")).toBeTruthy();
  });

  it("marks nothing when the server answered", () => {
    chip({ cloud_email: "ann@acme.example", cloud_connected: true });
    expect(screen.queryByRole("img", { name: /not answering/i })).toBeNull();
  });

  it("names a signed-in, connected person", () => {
    chip({ cloud_email: "ann@acme.example", cloud_connected: true });
    expect(screen.getByText("ann@acme.example")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("title")).toBe("Account");
    expect(screen.queryByText("Log in")).toBeNull();
  });

  it("offers Log in when nobody is signed in", () => {
    const { onLogIn } = chip({ cloud_email: "", cloud_connected: false });
    fireEvent.click(screen.getByText("Log in"));
    expect(onLogIn).toHaveBeenCalledOnce();
  });

  it("says nothing about the server when nobody is signed in", () => {
    // Not signed in is its own thing; the chip must not blame the
    // server for it, nor claim a connection it does not have.
    chip({ cloud_email: "", cloud_connected: false });
    const title = screen.getByRole("button").getAttribute("title");
    expect(title ?? "").not.toMatch(/not connected|not answering/i);
    expect(screen.queryByRole("img", { name: /not answering/i })).toBeNull();
  });

  it("offers Log in when nobody is signed in, even with a token", () => {
    chip({ cloud_email: "", cloud_connected: true });
    expect(screen.getByText("Log in")).toBeTruthy();
  });

  it("is a neutral, inert chip while who is signed in is not known yet", () => {
    // The desktop's cloud side, just after the switch: the VM's status
    // names nobody, and this computer has not said who is signed in.
    const onLogIn = vi.fn();
    render(
      <AccountChip
        status={{ cloud_email: "", cloud_connected: false }}
        name="Account"
        pending
        onOpenAccount={() => {}}
        onLogIn={onLogIn}
      />,
    );
    expect(screen.queryByText("Log in")).toBeNull();
    const button = screen.getByRole("button", { name: "Account" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onLogIn).not.toHaveBeenCalled();
  });

  it("names the person a pending status already names", () => {
    render(
      <AccountChip
        status={{ cloud_email: "ann@acme.example", cloud_connected: true }}
        name="ann@acme.example"
        pending
        onOpenAccount={() => {}}
        onLogIn={() => {}}
      />,
    );
    expect(screen.getByText("ann@acme.example")).toBeTruthy();
  });

  it("shows neither before the first status arrives", () => {
    const { container } = render(
      <AccountChip status={null} name="Account" onOpenAccount={() => {}} onLogIn={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });
});
