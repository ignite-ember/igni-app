// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { WindowServices } from "./windowServices";

describe("WindowServices", () => {
  it("reads the folder from ?dir= and the page from ?open=", () => {
    expect(WindowServices.openingFrom("?dir=%2Fwork&open=plugins&id=x")).toEqual({
      wantedDir: "/work",
      arrival: { page: "plugins", params: { id: "x" } },
    });
  });

  it("opens into nothing in particular without either", () => {
    expect(WindowServices.openingFrom("")).toEqual({ wantedDir: "", arrival: null });
  });

  it("builds a window whose sidebar follows its width until the model answers", () => {
    const host = { viewKey: "test-window", kind: "web" as const, notify: vi.fn(), onCloud: false, accountRpc: vi.fn() };
    const wide = WindowServices.create({ host, search: "?dir=/a", innerWidth: 1200 });
    expect(wide.core.windowModel.get("sidebar").open).toBe(true);
    expect(wide.chat.opening.wantedDir).toBe("/a");
    const narrow = WindowServices.create({ host, search: "", innerWidth: 400 });
    expect(narrow.core.windowModel.get("sidebar").open).toBe(false);
    expect(wide.shell.statusSource.accountElsewhere).toBe(false);
    expect(host.accountRpc).not.toHaveBeenCalled();
  });

  it("on the cloud side asks this computer's backend who is signed in", async () => {
    const accountRpc = vi.fn(async () => ({ cloud_email: "rita@acme.test" }));
    const host = { viewKey: "test-window", kind: "tauri" as const, notify: vi.fn(), onCloud: true, accountRpc };
    const services = WindowServices.create({ host, search: "", innerWidth: 1200 });
    expect(services.shell.statusSource.accountElsewhere).toBe(true);
    expect(await services.shell.statusSource.account()).toEqual({ ok: true, account: { cloud_email: "rita@acme.test" } });
    expect(accountRpc).toHaveBeenCalledWith("get_status");
  });
});
